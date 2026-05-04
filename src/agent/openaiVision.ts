import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';

import { logger } from '../utils/logger';
import { getOpenAI } from './openaiClient';
import { OPENAI_VISION_MODEL } from './openaiAgentModels';

export interface OpenAIVisionParams {
  prompt: string;
  imageBase64?: string;
  mimeType?: string;
  model?: string;
  maxTokens?: number;
}

/** Single-turn vision call using OpenAI vision models. Returns assistant message text. */
export async function openaiVisionCompletion(params: OpenAIVisionParams): Promise<string> {
  const model = params.model ?? OPENAI_VISION_MODEL;
  const t0 = Date.now();

  const parts: ChatCompletionContentPart[] = [];

  if (params.imageBase64 && params.mimeType) {
    const mime = params.mimeType === 'image/jpg' ? 'image/jpeg' : params.mimeType;
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${params.imageBase64}` },
    });
  }

  parts.push({ type: 'text', text: params.prompt });

  const res = await getOpenAI().chat.completions.create({
    model,
    max_tokens: params.maxTokens ?? 1024,
    messages: [{ role: 'user', content: parts }],
  });

  const text = res.choices[0]?.message?.content?.trim() ?? '';

  logger.info(
    { model, ms: Date.now() - t0, promptTokens: res.usage?.prompt_tokens },
    'openai vision completion',
  );

  return text;
}
