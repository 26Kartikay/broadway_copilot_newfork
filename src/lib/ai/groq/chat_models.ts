import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { ChatCompletion } from 'openai/resources/chat/completions';

import type { ChatCompletionCreateParamsNonStreaming as GroqChatCompletionParams } from 'groq-sdk/resources/chat/completions';
import { BufferedLlmTrace, TraceBuffer } from '../../../agent/tracing';
import { logger } from '../../../utils/logger';
import { MODEL_COSTS } from '../config/costs';
import { BaseChatCompletionsModel } from '../core/base_chat_completions_model';
import { BaseMessage, SystemMessage, TextPart } from '../core/messages';
import { toOpenAIToolSpec } from '../core/tools';
import { GroqChatModelParams, RunOutcome } from '../core/runnables';


type GroqParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * A chat model that interacts with the Groq API.
 * This class extends `BaseChatCompletionsModel` and is configured for Groq's endpoint.
 *
 * @example
 * ```typescript
 * const model = new ChatGroq({ model: 'llama3-70b-8192' });
 * const result = await model.run(
 * new SystemMessage('You are a helpful assistant.'),
 * [new UserMessage('Explain the importance of low-latency LLMs')],
 * 'some-graph-run-id'
 * );
 * console.log(result.assistant.content[0].text);
 * ```
 */
export class ChatGroq extends BaseChatCompletionsModel {
  protected client: Groq;
  public params: GroqChatModelParams;

  /**
   * Creates an instance of ChatGroq.
   * @param params - Optional parameters to override the model defaults.
   * @param client - An optional Groq client instance, useful for testing or custom configurations.
   */
  constructor(params: Partial<GroqChatModelParams> = {}) {
    const combinedParams: GroqChatModelParams = {
      model: 'llama-3.1-70b-versatile',
      ...params,
    };
    super(combinedParams);
    this.client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.structuredOutputToolName = 'json';
    this.params = combinedParams;
  }

  async run(
    systemPrompt: SystemMessage,
    msgs: BaseMessage[],
    traceBuffer: TraceBuffer,
    nodeName: string,
  ): Promise<RunOutcome> {
    
    // 💡 FIX APPLIED HERE: Correctly constructing the Groq tool specification.
    const addBoundTools = (p: GroqParams): GroqParams => {
      if (this.boundTools.length === 0) return p;

      // ----------------------------------------------------------------------
      // FIX START: Eliminate double-wrapping the tool definition.
      // We assume `toOpenAIToolSpec` returns the function properties (name, description, parameters).
      // Groq requires the format: { type: 'function', function: { ...properties... } }
      const boundToolSpecs = this.boundTools.map((t) => {
        const spec = toOpenAIToolSpec(t); // returns { name: '...', description: '...', parameters: { ... } }
        return {
          type: 'function' as const,
          function: { // Correctly nest the function properties under the 'function' key
            name: spec.name,
            description: spec.description ?? '',
            parameters: spec.parameters ?? {},
            // The `strict` property is a non-standard OpenAI extension usually handled 
            // by the client library, so we'll leave it out of the function definition 
            // unless the Groq SDK explicitly requires it here.
          },
        };
      });
      // FIX END
      // ----------------------------------------------------------------------

      const existingNames = new Set(
        (p as any).tools?.map((t: any) => t?.function?.name).filter(Boolean) ?? [],
      );

      // This logic correctly merges the existing tools (if any) with the bound ones
      const missingSpecs = boundToolSpecs.filter((t) => !existingNames.has(t.function.name));

      if (missingSpecs.length > 0) {
        (p as any).tools = [...((p as any).tools ?? []), ...missingSpecs];
      }

      if (!(p as any).tool_choice) {
        (p as any).tool_choice = 'auto';
      }

      return p;
    };

    const buildParams = () => addBoundTools(this._buildChatCompletionsParams(systemPrompt, msgs));
    let params = buildParams();

    const requestOptions: { maxRetries?: number; timeout?: number } = {};
    if (this.params.maxRetries !== undefined) {
      requestOptions.maxRetries = this.params.maxRetries;
    }
    if (this.params.timeout !== undefined) {
      requestOptions.timeout = this.params.timeout;
    }

    const nodeRun = traceBuffer.nodeRuns.find((ne) => ne.nodeName === nodeName && !ne.endTime);
    if (!nodeRun) {
      throw new Error(`Could not find an active node execution for nodeName: ${nodeName}`);
    }

    const startTime = new Date();

    const llmTrace: BufferedLlmTrace = {
      id: createId(),
      nodeRunId: nodeRun.id,
      model: this.params.model,
      inputMessages: params.messages as unknown as Prisma.JsonArray,
      rawRequest: params as unknown as Prisma.JsonObject,
      startTime,
    };

    let response: ChatCompletion;
    const callGroq = async (p: GroqChatCompletionParams) =>
      (await this.client.chat.completions.create(p, requestOptions)) as ChatCompletion;

    // Tool information is available in traceBuffer for debugging if needed

    try {
      response = await callGroq(params as unknown as GroqChatCompletionParams);
    } catch (err) {
      const maybeGroqError =
        err && typeof err === 'object' && 'status' in err && (err as any)?.status === 400;
      const maybeToolUseFailed =
        maybeGroqError &&
        typeof (err as any)?.error === 'object' &&
        (err as any)?.error?.error?.code === 'tool_use_failed';

      // Retry once without structured-output tool if tool-use failed (often due to mixed tool/JSON tool_choice issues)
      if (maybeToolUseFailed && this.structuredOutputSchema) {
        const strippedParams = buildParams();

        logger.debug('Retrying Groq request without structured output tool due to tool_use_failed');
        // Remove structured-output tool if present
        if (Array.isArray((strippedParams as any).tools)) {
          (strippedParams as any).tools = (strippedParams as any).tools?.filter(
            (t: any) => t?.function?.name !== this.structuredOutputToolName,
          );
        }
        // Ensure we allow normal tool calling
        (strippedParams as any).tool_choice = 'auto';
        try {
          response = await callGroq(strippedParams as unknown as GroqChatCompletionParams);
        } catch (retryErr) {
          const endTime = new Date();
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const stack = retryErr instanceof Error ? retryErr.stack : undefined;
          llmTrace.errorTrace = stack ?? message;
          llmTrace.endTime = endTime;
          llmTrace.durationMs = endTime.getTime() - startTime.getTime();
          traceBuffer.llmTraces.push(llmTrace);
          throw retryErr;
        }
      } else if (maybeToolUseFailed) {
        // Fallback: retry once with tools disabled so we can return a graceful text reply
        const noToolsParams = buildParams();
        (noToolsParams as any).tools = [];
        (noToolsParams as any).tool_choice = 'none';
        logger.debug('Groq fallback: retrying without tools due to tool_use_failed');
        try {
          response = await callGroq(noToolsParams as unknown as GroqChatCompletionParams);
        } catch (retryErr) {
          const endTime = new Date();
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const stack = retryErr instanceof Error ? retryErr.stack : undefined;
          llmTrace.errorTrace = stack ?? message;
          llmTrace.endTime = endTime;
          llmTrace.durationMs = endTime.getTime() - startTime.getTime();
          traceBuffer.llmTraces.push(llmTrace);
          throw retryErr;
        }
      } else {
        const endTime = new Date();
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        llmTrace.errorTrace = stack ?? message;
        llmTrace.endTime = endTime;
        llmTrace.durationMs = endTime.getTime() - startTime.getTime();
        traceBuffer.llmTraces.push(llmTrace);
        throw err;
      }
    }

    const { assistant, toolCalls } = this._processChatCompletionsResponse(response);

    const endTime = new Date();

    let costUsd: number | null = null;
    const modelCosts = MODEL_COSTS[this.params.model];
    if (modelCosts) {
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      const inputCost = (promptTokens / 1_000_000) * modelCosts.input;
      const outputCost = (completionTokens / 1_000_000) * modelCosts.output;
      costUsd = inputCost + outputCost;
    }

    llmTrace.rawResponse = response as unknown as Prisma.JsonObject;
    llmTrace.outputMessage = assistant.toJSON() as Prisma.JsonObject;
    llmTrace.promptTokens = response.usage?.prompt_tokens ?? null;
    llmTrace.completionTokens = response.usage?.completion_tokens ?? null;
    llmTrace.totalTokens = response.usage?.total_tokens ?? null;
    llmTrace.costUsd = costUsd ?? null;
    llmTrace.endTime = endTime;
    llmTrace.durationMs = endTime.getTime() - startTime.getTime();
    traceBuffer.llmTraces.push(llmTrace);

    return {
      assistant,
      toolCalls,
      raw: response,
    };
  }

  protected _buildChatCompletionsParams(
    systemPrompt: SystemMessage,
    msgs: BaseMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    const params = super._buildChatCompletionsParams(systemPrompt, msgs);

    // Groq doesn't support image inputs, so we need to filter them out
    params.messages = params.messages.map((m) => {
      if (m.role === 'user' && Array.isArray(m.content)) {
        return {
          ...m,
          content: m.content
            .filter((c): c is TextPart => c.type === 'text')
            .map((c) => c.text)
            .join(''),
        };
      }
      return m;
    });

    return params;
  }
}