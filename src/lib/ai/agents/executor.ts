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
 * Parses the final assistant message into a structured JSON output.
 * It takes the last message, if it's from the assistant, and asks the model
 * to format it into the desired schema with a specific, direct prompt.
 *
 * @param runner The chat model instance.
 * @param conversation The full conversation history.
 * @param outputSchema The Zod schema for the final output.
 * @returns A promise that resolves to the structured output.
 */
async function getFinalStructuredOutput<T extends ZodType>(
  runner: BaseChatModel,
  conversation: BaseMessage[],
  outputSchema: T,
  traceBuffer: TraceBuffer,
  nodeName: string,
): Promise<T['_output']> {
  // Find the most recent assistant message (the conversation can end on a ToolMessage
  // when we stop due to maxLoops).
  const lastMessage = [...conversation].reverse().find((m) => m instanceof AssistantMessage);

  // If the last message is an assistant's message, use it for parsing.
  if (lastMessage instanceof AssistantMessage) {
    const customPrompt = new SystemMessage(
      'You are parsing an assistant message that was generated in response to a user query. ' +
        'Extract the relevant information from the assistant\'s response and format it as a JSON object ' +
        'that strictly adheres to the provided schema. ' +
        'The assistant message contains styling advice, product recommendations, or similar content. ' +
        'Parse only the assistant\'s output, NOT the user\'s input. ' +
        'Do not add any extra commentary or change any of the values.',
    );

    const textContent = lastMessage.content
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('');

    // Use AssistantMessage instead of UserMessage to avoid confusion
    const parsingConversation: BaseMessage[] = [new AssistantMessage(textContent)];

    const structuredRunner = runner.withStructuredOutput(outputSchema);
    return await structuredRunner.run(customPrompt, parsingConversation, traceBuffer, nodeName);
  } else {
    throw new Error('Last message is not an assistant message');
  }
}

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
  // IMPORTANT: Don't use structured output during tool execution phase
  // Structured output forces tool_choice to only call the output tool, preventing other tools
  // We'll parse the final output manually after tools are done
  const runnerWithTools = runner.bind(options.tools);

  // Tool information is available in traceBuffer for debugging if needed

  const conversation: BaseMessage[] = [...history];

  const seenToolCallIds = new Set<string>();
  let maxLoopStop = false;
  let toolsWereCalled = false;
  const toolResultsList: Array<{ name: string; result: unknown }> = [];

  for (let i = 0; i < maxLoops; i++) {
    const { assistant, toolCalls } = await runnerWithTools.run(
      systemPrompt,
      conversation,
      traceBuffer,
      options.nodeName,
    );

    logger.debug(
      { nodeName: options.nodeName, iteration: i, toolCallsCount: toolCalls.length, toolNames: toolCalls.map(tc => tc.name) },
      'agentExecutor: LLM response received',
    );

    conversation.push(assistant);

    // Filter out structured output tool calls from the regular tool execution
    const regularToolCalls = toolCalls.filter(tc => {
      // Skip structured output tool calls during the tool execution phase
      const isStructuredOutput = tc.name === (runner as any).structuredOutputToolName || 
                                 tc.name === 'structured_output' || 
                                 tc.name === 'json';
      if (isStructuredOutput) {
        logger.debug({ nodeName: options.nodeName, toolName: tc.name }, 'agentExecutor: Skipping structured output tool call during execution phase');
        return false;
      }
      return true;
    });

    if (regularToolCalls.length > 0) {
      toolsWereCalled = true;
    }

    if (regularToolCalls.length === 0) {
      // Check if this is the first iteration and we have tools but none were called
      // This might indicate the model skipped tools - check if structured output tool was called instead
      const structuredOutputCalled = toolCalls.some(tc => {
        const name = tc.name.toLowerCase();
        return name.includes('structured') || name === 'json' || name === options.nodeName.toLowerCase();
      });
      
      if (i === 0 && !toolsWereCalled && structuredOutputCalled && options.tools.length > 0) {
        logger.warn(
          { nodeName: options.nodeName, toolsAvailable: options.tools.map(t => t.name) },
          'agentExecutor: Structured output tool called before regular tools - model may have skipped required tools',
        );
        // Force at least one more iteration by injecting a message asking to use tools
        conversation.push(new UserMessage('Please use the available tools before providing your final response. The tools are required to complete this task.'));
        continue;
      }
      
      logger.debug({ nodeName: options.nodeName, iteration: i, toolsWereCalled }, 'agentExecutor: No regular tool calls, breaking loop');
      break;
    }

    const toolResults = await Promise.all(
      regularToolCalls
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
            // Track tool results for later extraction
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

    if (i === maxLoops - 1) {
      maxLoopStop = true;
    }
  }

  // If we bailed because of maxLoops and the conversation ends on a ToolMessage,
  // run one more non-tool LLM call to let the model produce a final assistant message.
  const lastMessage = conversation[conversation.length - 1];
  if (maxLoopStop && !(lastMessage instanceof AssistantMessage)) {
    logger.warn(
      { nodeName: options.nodeName, maxLoops },
      'agentExecutor: maxLoops hit with trailing non-assistant message; forcing final assistant run',
    );
    const { assistant } = await runner.run(systemPrompt, conversation, traceBuffer, options.nodeName);
    conversation.push(assistant);
  }

  const output = await getFinalStructuredOutput(
    runner,
    conversation,
    options.outputSchema,
    traceBuffer,
    options.nodeName,
  );

  return { output, toolResults: toolResultsList };
}
