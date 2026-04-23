import { ChatAnthropic } from '../anthropic/chat_models';
import { ANTHROPIC_CHAT_MODEL, ANTHROPIC_VISION_MODEL } from '../../../agent/anthropicModels';

let chatLLM: ChatAnthropic | null = null;
let visionLLM: ChatAnthropic | null = null;

/** Cached Sonnet instance for main chat + tool calling. */
export function getChatLLM(): ChatAnthropic {
  if (!chatLLM) {
    chatLLM = new ChatAnthropic({ model: ANTHROPIC_CHAT_MODEL, maxTokens: 1024 });
  }
  return chatLLM;
}

/** Cached Sonnet instance for vision tasks. */
export function getVisionLLM(): ChatAnthropic {
  if (!visionLLM) {
    visionLLM = new ChatAnthropic({ model: ANTHROPIC_VISION_MODEL, maxTokens: 1024 });
  }
  return visionLLM;
}
