import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { OPENAI_VISION_MODEL } from './anthropicModels';

let client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

/** Single user turn with optional images (data URLs) + text; returns assistant message content string. */
export async function openaiVisionUserCompletion(params: {
  content: OpenAI.Chat.ChatCompletionContentPart[];
  model?: string;
  max_tokens?: number;
}): Promise<string> {
  const model = params.model ?? OPENAI_VISION_MODEL;
  const t0 = Date.now();
  const res = await getOpenAI().chat.completions.create({
    model,
    max_tokens: params.max_tokens ?? 1024,
    messages: [{ role: 'user', content: params.content }],
  });
  const text = res.choices[0]?.message?.content?.trim() ?? '';
  logger.info(
    { model, ms: Date.now() - t0, promptTokens: res.usage?.prompt_tokens },
    'openai vision chat.completions',
  );
  return text;
}
