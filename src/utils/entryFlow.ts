import type { MessageInput } from '../lib/chat/types';
import type { FlowType } from '../types/analytics';

const FLOW_INTENTS = new Set(['vibe_check', 'color_analysis', 'ask_ai', 'home']);

/** Derive analytics entry_flow from intent slug and optional button payload. */
export function entryFlowFromContext(intent?: string, messageInput?: MessageInput): FlowType {
  const payload = (messageInput?.ButtonPayload ?? '').toLowerCase();
  if (payload.includes('vibe')) return 'vibe_check';
  if (payload.includes('color')) return 'color_analysis';

  const normalized = (intent ?? '').toLowerCase().replace(/-/g, '_');
  if (normalized.includes('vibe')) return 'vibe_check';
  if (normalized.includes('color')) return 'color_analysis';
  if (FLOW_INTENTS.has(normalized as FlowType)) return normalized as FlowType;
  return 'ask_ai';
}
