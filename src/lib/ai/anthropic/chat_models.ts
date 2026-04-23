import Anthropic from '@anthropic-ai/sdk';
import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { BufferedLlmTrace, TraceBuffer } from '../../../agent/tracing';
import { MODEL_COSTS } from '../config/costs';
import { BaseChatModel } from '../core/base_chat_model';
import { AssistantMessage, BaseMessage, ImagePart, SystemMessage, TextPart } from '../core/messages';
import { ChatModelParams, RunOutcome } from '../core/runnables';
import { Tool, ToolCall } from '../core/tools';

type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const SUPPORTED_MEDIA = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function safeMime(raw: string): SupportedMediaType {
  const fixed = raw === 'image/jpg' ? 'image/jpeg' : raw;
  return SUPPORTED_MEDIA.has(fixed) ? (fixed as SupportedMediaType) : 'image/jpeg';
}

function toAnthropicToolSpec(tool: Tool): Anthropic.Messages.Tool {
  const rawSchema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  const { $schema: _s, ...schema } = rawSchema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Messages.Tool['input_schema'],
  };
}

function structuredOutputTool(toolName: string, schema: z.ZodType): Anthropic.Messages.Tool {
  const rawSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _s, ...clean } = rawSchema;
  return {
    name: toolName,
    description: 'Call this with your final response when all tool calls are complete.',
    input_schema: clean as Anthropic.Messages.Tool['input_schema'],
  };
}

/** Convert an ImagePart (internal format) to an Anthropic image block. */
function imagePartToBlock(p: ImagePart): Anthropic.Messages.ImageBlockParam {
  const url = p.image_url.url;
  if (url.startsWith('data:')) {
    const semi = url.indexOf(';');
    const comma = url.indexOf(',');
    if (semi > 0 && comma > semi) {
      const mime = url.slice(5, semi);
      const data = url.slice(comma + 1);
      return {
        type: 'image',
        source: { type: 'base64', media_type: safeMime(mime), data },
      };
    }
  }
  return { type: 'image', source: { type: 'url', url } };
}

/** Convert internal message list to Anthropic MessageParam[].
 *  Consecutive ToolMessages are merged into one user message with tool_result blocks. */
function toAnthropicMessages(msgs: BaseMessage[]): Anthropic.Messages.MessageParam[] {
  const out: Anthropic.Messages.MessageParam[] = [];
  let i = 0;

  while (i < msgs.length) {
    const m = msgs[i]!;

    if (m.role === 'user') {
      const content: Anthropic.Messages.ContentBlockParam[] = m.content.map((p) =>
        p.type === 'text'
          ? ({
              type: 'text',
              text: p.text.trim().length > 0 ? p.text : '(empty)',
            } satisfies Anthropic.Messages.TextBlockParam)
          : imagePartToBlock(p as ImagePart),
      );
      out.push({ role: 'user', content });
      i++;
    } else if (m.role === 'assistant') {
      const blocks: Anthropic.Messages.ContentBlockParam[] = [];
      const text = m.content
        .filter((p): p is TextPart => p.type === 'text')
        .map((p) => p.text)
        .join('')
        .trim();
      if (text) blocks.push({ type: 'text', text });

      const tcs = (m.meta?.tool_calls as ToolCall[] | undefined) ?? [];
      for (const tc of tcs) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments as Record<string, unknown>,
        });
      }
      // Anthropic rejects empty text blocks; never use text: ''
      if (blocks.length === 0) blocks.push({ type: 'text', text: '[no text]' });
      out.push({ role: 'assistant', content: blocks });
      i++;
    } else if (m.role === 'tool') {
      // Merge consecutive tool messages into one user message with tool_result blocks
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      while (i < msgs.length && msgs[i]!.role === 'tool') {
        const t = msgs[i]!;
        const toolContent = t.content
          .filter((p): p is TextPart => p.type === 'text')
          .map((p) => p.text)
          .join('');
        results.push({
          type: 'tool_result',
          tool_use_id: t.tool_call_id ?? '',
          content: toolContent.trim().length > 0 ? toolContent : '{}',
          is_error: t.meta?.isError === true,
        });
        i++;
      }
      out.push({ role: 'user', content: results });
    } else {
      i++;
    }
  }

  return out;
}

export class ChatAnthropic extends BaseChatModel {
  protected client: Anthropic;

  constructor(params: Partial<ChatModelParams> = {}) {
    super({ model: 'claude-sonnet-4-6', maxTokens: 1024, ...params });
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.structuredOutputToolName = 'json';
  }

  async run(
    systemPrompt: SystemMessage,
    msgs: BaseMessage[],
    traceBuffer: TraceBuffer,
    nodeName: string,
  ): Promise<RunOutcome> {
    const system = systemPrompt.content
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('');

    const messages = toAnthropicMessages(msgs);

    const tools: Anthropic.Messages.Tool[] = this.boundTools.map(toAnthropicToolSpec);
    if (this.structuredOutputSchema) {
      tools.push(structuredOutputTool(this.structuredOutputToolName, this.structuredOutputSchema));
    }

    const createParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: this.params.model,
      max_tokens: this.params.maxTokens ?? 1024,
      messages,
      ...(system ? { system } : {}),
      ...(tools.length > 0 ? { tools, tool_choice: { type: 'auto' } } : {}),
      ...(this.params.temperature !== undefined ? { temperature: this.params.temperature } : {}),
    };

    const nodeRun = traceBuffer.nodeRuns.find(
      (ne) => ne.nodeName === nodeName && !ne.endTime,
    );
    if (!nodeRun) throw new Error(`No active node execution for nodeName: ${nodeName}`);

    const startTime = new Date();
    const llmTrace: BufferedLlmTrace = {
      id: createId(),
      nodeRunId: nodeRun.id,
      model: this.params.model,
      inputMessages: messages as unknown as Prisma.JsonArray,
      rawRequest: createParams as unknown as Prisma.JsonObject,
      startTime,
    };

    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create(createParams);
    } catch (err) {
      const endTime = new Date();
      llmTrace.errorTrace = err instanceof Error ? (err.stack ?? err.message) : String(err);
      llmTrace.endTime = endTime;
      llmTrace.durationMs = endTime.getTime() - startTime.getTime();
      traceBuffer.llmTraces.push(llmTrace);
      throw err;
    }

    const textContent = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.input,
    }));

    const assistant = new AssistantMessage(textContent);
    assistant.meta = { raw: response, finish_reason: response.stop_reason };
    if (toolCalls.length > 0) {
      assistant.meta.tool_calls = toolCalls;
      assistant.meta.raw_tool_calls = toolUseBlocks;
    }

    const endTime = new Date();
    let costUsd: number | null = null;
    const costs = MODEL_COSTS[this.params.model];
    if (costs) {
      costUsd =
        (response.usage.input_tokens / 1_000_000) * costs.input +
        (response.usage.output_tokens / 1_000_000) * costs.output;
    }

    llmTrace.rawResponse = response as unknown as Prisma.JsonObject;
    llmTrace.outputMessage = assistant.toJSON() as Prisma.JsonObject;
    llmTrace.promptTokens = response.usage.input_tokens;
    llmTrace.completionTokens = response.usage.output_tokens;
    llmTrace.totalTokens = response.usage.input_tokens + response.usage.output_tokens;
    llmTrace.costUsd = costUsd;
    llmTrace.endTime = endTime;
    llmTrace.durationMs = endTime.getTime() - startTime.getTime();
    traceBuffer.llmTraces.push(llmTrace);

    return { assistant, toolCalls, raw: response };
  }
}
