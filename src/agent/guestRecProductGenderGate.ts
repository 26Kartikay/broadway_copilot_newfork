import { randomUUID } from 'crypto';

import type { Gender, User } from '@prisma/client';

import type { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { isGuestUser } from '../utils/user';

import type { HttpReplyPayload } from './httpReplies';
import { classifyIntent } from './intentClassifier';
import {
  clearGuestCatalogGenderMix,
  clearGuestRecGenderOptOut,
  clearGuestRecMessageStash,
  getGuestRecGenderOptOut,
  getGuestRecMessageStash,
  getHistory,
  getHttpPendingFlow,
  invalidateContext,
  messageInputToStashRecord,
  setGuestCatalogGenderMix,
  setGuestRecGenderOptOut,
  setGuestRecMessageStash,
  stashRecordToMessageInput,
  type StoredMessage,
} from './memory/redis';

export type GuestRecProductGenderGateResult =
  | { kind: 'pass' }
  | { kind: 'prompt'; replies: HttpReplyPayload[] }
  | { kind: 'replay'; messageInput: MessageInput };

const CHITCHAT_TINY =
  /^(hi+|hello+|hey+|hii+|yo+|sup|thanks|thank you|thx|ok+|okay+|cool|sure|yep|nope|nah)\.?$/i;

function isCompactEscape(text: string): boolean {
  return /\b(never mind|nevermind|forget it|cancel|go back|stop|not now|skip|exit|quit)\b/i.test(text);
}

/** Heuristic: user is steering toward catalog / picks (guest product-rec gate). */
export function looksLikeProductRecRequest(body: string, buttonPayload?: string): boolean {
  const bp = (buttonPayload || '').trim();
  const text = (body || '').trim();

  if (bp.startsWith('guest_rec_gender_')) return false;
  if (bp.startsWith('guest_gender_')) return false;
  if (bp.startsWith('save_color_analysis')) return false;
  if (bp === 'color_analysis' || bp === 'vibe_check' || bp.startsWith('tonality_')) return false;

  if (text.length > 0 && text.length < 48 && CHITCHAT_TINY.test(text)) return false;

  if (bp && /\b(shop|browse|catalog|recommend|product|more|pick|style)\b/i.test(bp)) return true;

  const t = text.toLowerCase();
  if (!t) return false;

  return (
    /\b(show me|find( me)?|look(ing)? for|need|want to buy|help me (find|pick|shop)|browse|shop|buy|recommend|suggestion|suggestions|products?|catalog|options?|picks?|pieces?|items?|gift ideas|something to wear)\b/.test(
      t,
    ) ||
    /\b(more|else|other|another|different)\b.*\b(options?|ones?|picks?|products?|ideas)\b/.test(t) ||
    /\b(dress|shirt|top|jeans|pants|trousers|shoes|sneakers|bag|jacket|skirt|blazer|heels|boots|sandal|kurta|saree|jewellery|jewelry|watch|sunglass|lipstick|moisturizer|serum)\b/.test(
      t,
    )
  );
}

/**
 * Shopping-aisle prompt only until the guest explicitly confirms gender (quick-reply).
 * `inferredGender` alone must not skip the gate — it is often missing or wrong for catalog fit.
 */
function guestNeedsRecGenderPrompt(user: User | null): boolean {
  if (!isGuestUser(user)) return false;
  return !user?.confirmedGender;
}

function extractTextFromStoredContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join(' ');
  }
  return String(content);
}

function buildRollingContextForGate(history: StoredMessage[]): string {
  if (history.length === 0) return '';
  return history
    .slice(-6)
    .map((m) => {
      const content = extractTextFromStoredContent(m.content);
      return `${m.role}: ${content.slice(0, 120)}`;
    })
    .join('\n');
}

/** Same notion of “shopping turn” as the orchestrator when keywords are ambiguous. */
async function isProductRecIntentForGate(
  prismaUserId: string,
  utterance: string,
  hasImages: boolean,
): Promise<boolean> {
  if (hasImages) return false;
  const history = await getHistory(prismaUserId);
  const rolling = buildRollingContextForGate(history);
  const { intent, searchMeta } = await classifyIntent(utterance, false, rolling);
  if (searchMeta.isEscapeSignal) return false;
  return intent === 'product_search' || intent === 'outfit' || intent === 'beauty';
}

async function shouldGateGuestProductTurn(
  prismaUserId: string,
  utterance: string,
  buttonPayload: string | undefined,
  nMedia: number,
): Promise<boolean> {
  if (nMedia > 0) return false;
  if (utterance.length > 0 && utterance.length < 48 && CHITCHAT_TINY.test(utterance)) return false;
  if (looksLikeProductRecRequest(utterance, buttonPayload)) return true;
  return isProductRecIntentForGate(prismaUserId, utterance, false);
}

function buildGenderGatePrompt(): HttpReplyPayload[] {
  return [
    {
      reply_type: 'text',
      reply_text:
        'If you are comfortable sharing, do you usually shop menswear, womenswear, or would you rather not say? It just helps me narrow recommendations a little.',
    },
    {
      reply_type: 'quick_reply',
      reply_text: 'Optional — tap one below.',
      buttons: [
        { text: "Men's", id: 'guest_rec_gender_male' },
        { text: "Women's", id: 'guest_rec_gender_female' },
        { text: 'Prefer not to say', id: 'guest_rec_gender_prefer_not' },
      ],
    },
  ];
}

/**
 * Guest-only gate before running product-style turns: if gender is unknown, ask once (per stashed
 * shopping message), stash the original request, then replay it after the user answers.
 */
export async function tryGuestRecProductGenderGate(
  prismaUserId: string,
  input: MessageInput,
  user: User | null,
): Promise<GuestRecProductGenderGateResult> {
  const utterance = (input.Body || input.ButtonText || '').trim();
  const bp = input.ButtonPayload;
  const nMedia = Math.min(10, parseInt(input.NumMedia || '0', 10) || 0);

  if (!isGuestUser(user)) return { kind: 'pass' };

  const pendingFlow = await getHttpPendingFlow(prismaUserId);
  if (pendingFlow.type !== 'NONE') return { kind: 'pass' };

  if (nMedia > 0) {
    const stash = await getGuestRecMessageStash(prismaUserId);
    if (stash) await clearGuestRecMessageStash(prismaUserId);
    return { kind: 'pass' };
  }

  const stash = await getGuestRecMessageStash(prismaUserId);
  const optOut = await getGuestRecGenderOptOut(prismaUserId);

  // ── Answer step (replay stashed shopping message) ─────────────────────────
  if (
    bp === 'guest_rec_gender_male' ||
    bp === 'guest_rec_gender_female' ||
    bp === 'guest_rec_gender_prefer_not'
  ) {
    if (!stash) {
      logger.debug({ prismaUserId, bp }, 'Guest rec gender button with no stashed message — ignoring');
      return { kind: 'pass' };
    }

    await clearGuestRecMessageStash(prismaUserId);

    if (bp === 'guest_rec_gender_prefer_not') {
      await setGuestRecGenderOptOut(prismaUserId);
      await setGuestCatalogGenderMix(prismaUserId, true);
    } else if (user) {
      const gender: Gender = bp === 'guest_rec_gender_male' ? 'MALE' : 'FEMALE';
      await prisma.user.update({
        where: { id: prismaUserId },
        data: { confirmedGender: gender },
      });
      await clearGuestRecGenderOptOut(prismaUserId);
      await clearGuestCatalogGenderMix(prismaUserId);
      await invalidateContext(prismaUserId);
    }

    const replaySid = `msg_guestrec_${randomUUID()}`;
    const replayInput = stashRecordToMessageInput(stash, replaySid);
    logger.info({ prismaUserId, bp }, 'Guest rec gender gate: replaying stashed product message');
    return { kind: 'replay', messageInput: replayInput };
  }

  if (!guestNeedsRecGenderPrompt(user) || optOut) return { kind: 'pass' };

  // ── Stash exists: refine / cancel / unrelated ───────────────────────────────
  if (stash) {
    if (isCompactEscape(utterance)) {
      await clearGuestRecMessageStash(prismaUserId);
      return { kind: 'pass' };
    }
    const stillShopping = await shouldGateGuestProductTurn(prismaUserId, utterance, bp, nMedia);
    if (stillShopping) {
      await setGuestRecMessageStash(prismaUserId, messageInputToStashRecord(input));
      logger.info({ prismaUserId }, 'Guest rec gender gate: refreshed stash, re-prompting');
      return { kind: 'prompt', replies: buildGenderGatePrompt() };
    }
    await clearGuestRecMessageStash(prismaUserId);
    return { kind: 'pass' };
  }

  // ── First hit: shopping signal without explicit confirmed gender ─────────────
  const gateShopping = await shouldGateGuestProductTurn(prismaUserId, utterance, bp, nMedia);
  if (gateShopping) {
    await setGuestRecMessageStash(prismaUserId, messageInputToStashRecord(input));
    logger.info({ prismaUserId }, 'Guest rec gender gate: prompting before product run');
    return { kind: 'prompt', replies: buildGenderGatePrompt() };
  }

  return { kind: 'pass' };
}
