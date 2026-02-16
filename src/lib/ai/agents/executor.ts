import { ZodType } from 'zod';
import { TraceBuffer } from '../../../agent/tracing';
import { logger } from '../../../utils/logger';
import { BaseChatModel } from '../core/base_chat_model';
import {
  AssistantMessage,
  BaseMessage,
  SystemMessage,
  TextPart,
  ToolMessage,
  UserMessage,
} from '../core/messages';
import { Tool } from '../core/tools';

const MAX_ITERATIONS = 5;

/**
 * Orchestrates an agentic loop of model calls and tool executions to fulfill a user request.
 * The executor manages the conversation history, calls tools when requested by the model,
 * and feeds the results back to the model until a final answer is generated.
 *
 * @param runner The chat model instance to use.
 * @param systemPrompt A guiding prompt for the agent's persona and objective.
 * @param history The initial conversation history, typically starting with a user message.
 * @param options An object containing the list of available `tools` and a Zod `outputSchema`.
 * @param maxLoops The maximum number of tool-call iterations before stopping. Defaults to 5.
 * @returns A promise that resolves to the structured output.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { Tool } from '../core/tools';
 * import { ChatOpenAI } from '../openai/chat_models';
 *
 * const model = new ChatOpenAI({ model: 'gpt-4o-mini' });
 * const weatherTool = new Tool({
 *   name: 'get_weather',
 *   description: 'Get weather for a location',
 *   schema: z.object({ location: z.string() }),
 *   func: async ({ location }) => `The weather in ${location} is sunny.`,
 * });
 *
 * const output = await agentExecutor(
 *   model,
 *   new SystemMessage('You are a helpful weather assistant.'),
 *   [new UserMessage('What is the weather in New York?')],
 *   {
 *     tools: [weatherTool],
 *     outputSchema: z.object({ weather: z.string() }),
 *     nodeName: 'weatherAgent',
 *   },
 *   traceBuffer,
 * );
 *
 * // output.weather might be: "The weather in New York is sunny."
 * ```
 */
export async function agentExecutor<T extends ZodType>(
  runner: BaseChatModel,
  systemPrompt: SystemMessage,
  history: BaseMessage[],
  options: {
    tools: Tool[];
    outputSchema: T;
    nodeName: string;
  },
  traceBuffer: TraceBuffer,
  maxLoops: number = MAX_ITERATIONS,
): Promise<{ output: T['_output']; toolResults: Array<{ name: string; result: unknown }> }> {
  // Set structured output schema on the runner so it knows to return JSON
  // This is critical when tools are involved - the model needs to know to return structured output
  // We use type assertion to access the protected property
  (runner as any).structuredOutputSchema = options.outputSchema;
  const runnerWithTools = runner.bind(options.tools);
  const conversation: BaseMessage[] = [...history];

  const seenToolCallIds = new Set<string>();
  const toolResultsList: Array<{ name: string; result: unknown }> = [];

  for (let i = 0; i < maxLoops; i++) {
    const { assistant, toolCalls } = await runnerWithTools.run(
      systemPrompt,
      conversation,
      traceBuffer,
      options.nodeName,
    );

    logger.debug(
      {
        nodeName: options.nodeName,
        iteration: i,
        toolCallsCount: toolCalls.length,
        toolNames: toolCalls.map((tc) => tc.name),
      },
      'agentExecutor: LLM response received',
    );

    conversation.push(assistant);

    if (toolCalls.length === 0) {
      logger.debug(
        { nodeName: options.nodeName, iteration: i },
        'agentExecutor: No tool calls, attempting to parse final output.',
      );

      try {
        const content = assistant.content
          .filter((p): p is TextPart => p.type === 'text')
          .map((p) => p.text)
          .join('');

        // Extract JSON from markdown code blocks if present, otherwise use content as-is
        let jsonString = content.trim();
        const jsonBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch && jsonBlockMatch[1]) {
          jsonString = jsonBlockMatch[1].trim();
        }

        // If still doesn't start with {, try to find JSON object in the content
        if (!jsonString.startsWith('{')) {
          const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
          if (jsonObjectMatch) {
            jsonString = jsonObjectMatch[0];
          } else {
            throw new Error('Final response is not a JSON object.');
          }
        }

        const parsedJson = JSON.parse(jsonString);
        const validatedOutput = options.outputSchema.parse(parsedJson);
        return { output: validatedOutput, toolResults: toolResultsList };
      } catch (error) {
        logger.warn(
          { nodeName: options.nodeName, error: error instanceof Error ? error.message : String(error) },
          'agentExecutor: Failed to parse final JSON output. Adding corrective prompt.',
        );

        if (i === maxLoops - 1) {
          throw new Error(
            `Failed to get valid JSON output after ${maxLoops} attempts. Last error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        conversation.push(
          new UserMessage(
            'That was not valid JSON. Please provide your final answer again, ensuring it is a single, valid JSON object that matches the required schema and nothing else.',
          ),
        );
        continue;
      }
    }

    const toolResults = await Promise.all(
      toolCalls
        .filter((toolCall) => !seenToolCallIds.has(toolCall.id))
        .map(async (toolCall) => {
          seenToolCallIds.add(toolCall.id);
          const toolDef = options.tools.find((t) => t.name === toolCall.name);
          if (!toolDef) {
            return {
              id: toolCall.id,
              name: toolCall.name,
              result: `Tool '${toolCall.name}' not found.`,
              isError: true,
            };
          }
          try {
            const parsedArgs = toolDef.schema.parse(toolCall.arguments);
            const result = await Promise.resolve(toolDef.func(parsedArgs));
            toolResultsList.push({ name: toolDef.name, result });
            return {
              id: toolCall.id,
              name: toolDef.name,
              result,
              isError: false,
            };
          } catch (error) {
            return {
              id: toolCall.id,
              name: toolCall.name,
              result: `Error executing tool '${toolCall.name}': ${
                error instanceof Error ? error.message : String(error)
              }`,
              isError: true,
            };
          }
        }),
    );

    if (toolResults.length === 0) {
      break;
    }

    toolResults.forEach((toolResult) => {
      conversation.push(
        new ToolMessage(
          JSON.stringify(toolResult.result, null, 2),
          toolResult.id,
          toolResult.name,
          toolResult.isError,
        ),
      );
    });
  }

  throw new Error(`Agent failed to return a valid output after ${maxLoops} iterations.`);
}
