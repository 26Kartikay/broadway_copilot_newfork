import { OPENAI_CHAT_MODEL, OPENAI_VISION_MODEL } from '../../../agent/openaiAgentModels';
import { ChatOpenAI } from '../openai/chat_models';

let chatLLM: ChatOpenAI | null = null;
let visionLLM: ChatOpenAI | null = null;

export function getChatLLM(): ChatOpenAI {
  if (!chatLLM) {
    chatLLM = new ChatOpenAI({ model: OPENAI_CHAT_MODEL, maxTokens: 1024 });
  }
  return chatLLM;
}

export function getVisionLLM(): ChatOpenAI {
  if (!visionLLM) {
    visionLLM = new ChatOpenAI({ model: OPENAI_VISION_MODEL, maxTokens: 1024 });
  }
  return visionLLM;
}
