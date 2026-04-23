import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import { ANTHROPIC_VISION_MODEL } from './anthropicModels';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const SUPPORTED: SupportedMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function normalizeMediaType(raw: string): SupportedMediaType {
  if (raw === 'image/jpg') return 'image/jpeg';
  return SUPPORTED.includes(raw as SupportedMediaType) ? (raw as SupportedMediaType) : 'image/jpeg';
}

export interface AnthropicVisionParams {
  prompt: string;
  imageBase64?: string;
  mimeType?: string;
  model?: string;
  maxTokens?: number;
}

/** Single-turn vision call using Claude Sonnet. Returns the assistant message text. */
export async function anthropicVisionCompletion(params: AnthropicVisionParams): Promise<string> {
  const model = params.model ?? ANTHROPIC_VISION_MODEL;
  const t0 = Date.now();

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (params.imageBase64 && params.mimeType) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: normalizeMediaType(params.mimeType),
        data: params.imageBase64,
      },
    });
  }

  content.push({ type: 'text', text: params.prompt });

  const res = await getClient().messages.create({
    model,
    max_tokens: params.maxTokens ?? 1024,
    messages: [{ role: 'user', content }],
  });

  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  logger.info(
    { model, ms: Date.now() - t0, inputTokens: res.usage.input_tokens },
    'anthropic vision message',
  );

  return text;
}
