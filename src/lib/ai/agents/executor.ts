import { z, ZodType } from 'zod';
import { TraceBuffer } from '../../../agent/tracing';
import { logger } from '../../../utils/logger';
import { BaseChatModel } from '../core/base_chat_model';
import { BaseMessage, SystemMessage, TextPart, ToolMessage, UserMessage } from '../core/messages';
import { Tool } from '../core/tools';

const MAX_ITERATIONS = 5;

/**
 * GPT models sometimes echo JSON Schema (reply as { type, description }) instead of a real string.
 * Normalize before Zod validation.
 */
function coerceSchemaEchoToPayload(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const o = parsed as Record<string, unknown>;

  if (typeof o.reply === 'string') return parsed;

  const replyObj = o.reply;
  if (replyObj && typeof replyObj === 'object' && !Array.isArray(replyObj)) {
    const d = (replyObj as { description?: unknown }).description;
    if (typeof d === 'string' && d.trim().length > 0) {
      return {
        ...o,
        reply: d.trim(),
      };
    }
  }

  const props = o.properties as Record<string, unknown> | undefined;
  const nested = props?.reply;
  if (nested && typeof nested === 'object' && nested !== null) {
    const d = (nested as { description?: unknown }).description;
    if (typeof d === 'string' && d.trim().length > 0) {
      const out: Record<string, unknown> = { reply: d.trim() };
      const ut = o.used_tools ?? (props.used_tools as unknown);
      if (Array.isArray(ut)) out.used_tools = ut;
      const sf = o.suggested_follow_up ?? (props.suggested_follow_up as unknown);
      if (sf !== undefined) out.suggested_follow_up = sf;
      return out;
    }
  }

  return parsed;
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
  // Set structured output schema on the runner so it knows to return JSON
  runner.structuredOutputToolName = runner.structuredOutputToolName || 'json';
  runner.attachExecutorStructuredOutput(options.outputSchema);

  const runnerWithTools = runner.bind(options.tools);
  const conversation: BaseMessage[] = [...history];

  const toolName = runner.structuredOutputToolName || 'json';
  const jsonInstruction = `\n\nFINAL RESPONSE (after any tool calls):
- Prefer invoking the tool "${toolName}" with arguments { "reply": "<your user-visible message as a plain string>", "used_tools": optional string[], "suggested_follow_up": optional string or null }.
- Or output a single compact JSON object only, e.g. {"reply":"Hello!","used_tools":[]}
- Do NOT echo JSON Schema, $schema, or nest "reply" as { "type", "description" }. The "reply" value must be the actual message text as one string.
- Do not wrap your answer in schema metadata.`;

  const systemPromptContent = systemPrompt.content
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');

  const enhancedSystemPrompt = new SystemMessage(systemPromptContent + jsonInstruction);

  const seenToolCallIds = new Set<string>();
  const toolResultsList: Array<{ name: string; result: unknown }> = [];

  for (let i = 0; i < maxLoops; i++) {
    const { assistant, toolCalls } = await runnerWithTools.run(
      enhancedSystemPrompt,
      conversation,
      traceBuffer,
      options.nodeName,
    );

    logger.debug(
      {
        nodeName: options.nodeName,
        model: runner.params.model,
        iteration: i,
        toolCallsCount: toolCalls.length,
        toolNames: toolCalls.map((tc) => tc.name),
      },
      'agentExecutor: LLM response received',
    );

    conversation.push(assistant);

    // Check if any tool call is the structured output tool
    const jsonToolCall = toolCalls.find((tc) => tc.name === runner.structuredOutputToolName);
    if (jsonToolCall) {
      logger.debug(
        { nodeName: options.nodeName, model: runner.params.model, iteration: i },
        'agentExecutor: Model called structured output tool.',
      );
      try {
        const coercedArgs = coerceSchemaEchoToPayload(jsonToolCall.arguments);
        const validatedOutput = options.outputSchema.parse(coercedArgs);
        return { output: validatedOutput, toolResults: toolResultsList };
      } catch (error) {
        logger.warn(
          { error, args: jsonToolCall.arguments },
          'agentExecutor: Failed to parse structured output tool call.',
        );
        // If it failed, we'll continue and maybe the model will fix it in the next iteration
      }
    }

    if (toolCalls.length === 0) {
      logger.debug(
        { nodeName: options.nodeName, model: runner.params.model, iteration: i },
        'agentExecutor: No tool calls, attempting to parse final output from text.',
      );

      try {
        const content = assistant.content
          .filter((p): p is TextPart => p.type === 'text')
          .map((p) => p.text)
          .join('');

        const rawTrim = content.trim();
        // Plain prose with no JSON — accept as reply (common when the model skips format)
        if (rawTrim.length > 0 && !rawTrim.includes('{')) {
          const plain = options.outputSchema.safeParse({ reply: rawTrim });
          if (plain.success) {
            return { output: plain.data, toolResults: toolResultsList };
          }
        }

        // Extract JSON from markdown code blocks if present, otherwise use content as-is
        let jsonString = rawTrim;

        // Strategy 1: Try to extract from markdown code blocks
        const jsonBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch && jsonBlockMatch[1]) {
          jsonString = jsonBlockMatch[1].trim();
        }

        // Strategy 2: If still doesn't start with {, try to find JSON object in the content
        if (!jsonString.startsWith('{')) {
          // Try to find the first complete JSON object (handles nested braces)
          let braceCount = 0;
          let startIdx = -1;
          let endIdx = -1;

          for (let idx = 0; idx < jsonString.length; idx++) {
            if (jsonString[idx] === '{') {
              if (startIdx === -1) startIdx = idx;
              braceCount++;
            } else if (jsonString[idx] === '}') {
              braceCount--;
              if (braceCount === 0 && startIdx !== -1) {
                endIdx = idx;
                break;
              }
            }
          }

          if (startIdx !== -1 && endIdx !== -1) {
            jsonString = jsonString.substring(startIdx, endIdx + 1);
          } else {
            // Fallback: try regex match (less reliable for nested objects)
            const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
            if (jsonObjectMatch) {
              jsonString = jsonObjectMatch[0];
            } else {
              throw new Error('Final response is not a JSON object.');
            }
          }
        }

        // Strategy 3: Clean up common issues
        // Remove trailing commas before closing braces/brackets
        jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');

        const parsedJson = JSON.parse(jsonString);
        const coerced = coerceSchemaEchoToPayload(parsedJson);
        const validatedOutput = options.outputSchema.parse(coerced);
        return { output: validatedOutput, toolResults: toolResultsList };
      } catch (error) {
        // Only warn if this is not the last attempt (if it's the last, we'll throw anyway)
        // This reduces noise from warnings that recover on the next iteration
        if (i < maxLoops - 1) {
          logger.debug(
            {
              nodeName: options.nodeName,
              iteration: i,
              error: error instanceof Error ? error.message : String(error),
              contentPreview: assistant.content
                .filter((p): p is TextPart => p.type === 'text')
                .map((p) => p.text)
                .join('')
                .substring(0, 200),
            },
            'agentExecutor: Failed to parse JSON output, will retry with corrective prompt.',
          );
        } else {
          // Last attempt - log as warning since we're about to throw
          logger.warn(
            {
              nodeName: options.nodeName,
              error: error instanceof Error ? error.message : String(error),
              contentPreview: assistant.content
                .filter((p): p is TextPart => p.type === 'text')
                .map((p) => p.text)
                .join('')
                .substring(0, 200),
            },
            'agentExecutor: Failed to parse final JSON output after all attempts.',
          );
        }

        if (i === maxLoops - 1) {
          throw new Error(
            `Failed to get valid JSON output after ${maxLoops} attempts. Last error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        conversation.push(
          new UserMessage(
            `That was not valid. Call the "${toolName}" tool with reply as a plain string, or output only {"reply":"...your text..."}. Do not output JSON Schema or nested type/description objects.`,
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
