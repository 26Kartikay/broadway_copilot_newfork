import type { Prisma, User } from '@prisma/client';
import { formatColorCombos, shuffleArray } from '../data/colorAnalysisHelpers';
import { getPaletteData, isValidPalette, resolveSeasonalPalette } from '../data/seasonalPalettes';
import type { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { isGuestUser } from '../utils/user';
import { formatReplies } from './formatReply';
import type { HttpReplyPayload } from './httpReplies';
import {
  appendToHistory,
  clearHttpPendingFlow,
  clearStagedColorAnalysis,
  getHttpPendingFlow,
  getStagedColorAnalysis,
  invalidateContext,
  setHttpPendingFlow,
} from './memory/redis';
import { AgentResult } from './orchestrator';
import { analyzeColorSeason } from './tools/colorAnalysis';
import { vibeCheck } from './tools/vibeCheck';

const TONALITY_BUTTON_TO_ENUM: Record<string, string> = {
  tonality_savage: 'savage',
  tonality_friendly: 'friendly',
  tonality_hype_bff: 'hype_bff',
};

function numMediaOf(input: MessageInput): number {
  return Math.min(10, parseInt(input.NumMedia || '0', 10) || 0);
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let mimeType = response.headers.get('content-type') || 'image/jpeg';
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) {
    mimeType = 'image/jpeg';
  }
  return { data: buffer.toString('base64'), mimeType };
}

function wantsFetchSavedPalette(text: string, buttonPayload?: string): boolean {
  if (buttonPayload === 'color_analysis_fetch_saved') return true;
  const t = text.toLowerCase();
  if (
    /\b(saved palette|last palette|previous palette|fetch my palette|load my palette|my saved palette)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(last|previous)\s+(color analysis|palette read|season read)\b/.test(t)) return true;
  if (/\b(fetch|retrieve|load)\b/.test(t) && /\b(saved|stored|last|previous)\b/.test(t)) {
    return /\b(palette|color analysis|season)\b/.test(t);
  }
  return false;
}

function wantsNewColorAnalysis(text: string, buttonPayload?: string): boolean {
  if (buttonPayload === 'color_analysis') return true;
  const t = text.toLowerCase();
  if (wantsFetchSavedPalette(text)) return false;
  return /\b(color analysis|seasonal colou?rs?|seasonal palette|undertone|what season am i|analyze my colou?rs?)\b/.test(
    t,
  );
}

function wantsNewVibeCheck(text: string, buttonPayload?: string): boolean {
  if (buttonPayload === 'vibe_check') return true;
  const t = text.toLowerCase();
  return /\b(vibe check|rate my outfit|outfit check|how('?s| is) my outfit)\b/.test(t);
}

function resolveTonalityFromPayload(buttonPayload: string): string | null {
  return TONALITY_BUTTON_TO_ENUM[buttonPayload] ?? null;
}

async function userHasSavedColorAnalysis(userId: string): Promise<boolean> {
  const row = await prisma.colorAnalysis.findFirst({ where: { userId }, select: { id: true } });
  return Boolean(row);
}

async function buildRepliesFromColorTool(
  color: Record<string, unknown>,
  user: User | null,
  introText?: string,
  opts?: { skipColorSavePrompt?: boolean },
): Promise<HttpReplyPayload[]> {
  const agentLike: AgentResult = {
    text: introText ?? String(color.compliment ?? '').trim(),
    toolResults: [{ toolName: 'analyze_color_season', ...color }],
    products: [],
    colorAnalysis: { toolName: 'analyze_color_season', ...color },
    vibeCheck: null,
  };
  const formatOpts =
    opts?.skipColorSavePrompt === true ? { user, skipColorSavePrompt: true as const } : { user };
  return formatReplies(agentLike, formatOpts);
}

async function buildRepliesFromVibeTool(
  vc: Record<string, unknown>,
  user: User | null,
  introText?: string,
): Promise<HttpReplyPayload[]> {
  const agentLike: AgentResult = {
    text: introText ?? String(vc.comment ?? '').trim(),
    toolResults: [{ toolName: 'vibe_check', ...vc }],
    products: [],
    colorAnalysis: null,
    vibeCheck: { toolName: 'vibe_check', ...vc },
  };
  return formatReplies(agentLike, { user });
}

async function appendFlowHistory(
  prismaUserId: string,
  input: MessageInput,
  replies: HttpReplyPayload[],
): Promise<void> {
  const userBits: string[] = [];
  if (input.Body?.trim()) userBits.push(input.Body.trim());
  if (input.ButtonText?.trim()) userBits.push(`[button: ${input.ButtonText}]`);
  if (input.ButtonPayload) userBits.push(`[payload: ${input.ButtonPayload}]`);
  if (numMediaOf(input) > 0) userBits.push(`[${numMediaOf(input)} image(s)]`);
  const userLine = userBits.join(' ') || '(empty)';
  const assistantLine = replies
    .map((r) => ('reply_text' in r ? (r as { reply_text?: string }).reply_text : '') || '')
    .filter(Boolean)
    .join('\n')
    .trim();
  await appendToHistory(prismaUserId, [{ type: 'text', text: userLine }], assistantLine || '…');
}

async function runColorAnalysisOnMedia(
  prismaUserId: string,
  input: MessageInput,
  user: User | null,
): Promise<{ replies: HttpReplyPayload[]; pendingOut: string | null }> {
  const url = input.MediaUrl0;
  if (!url) {
    return {
      replies: await buildRepliesFromColorTool(
        { error: 'Missing image URL — please upload again.' },
        user,
      ),
      pendingOut: 'COLOR_ANALYSIS_IMAGE',
    };
  }
  const { data, mimeType } = await fetchImageAsBase64(url);
  const sourceImageUrl = input.MediaUrl0;
  const raw = await analyzeColorSeason({
    userId: prismaUserId,
    imageBase64: data,
    mimeType,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  });

  if (raw.error) {
    const errReplies = await buildRepliesFromColorTool(
      { error: raw.error },
      user,
      typeof raw.error === 'string' ? raw.error : 'Something went wrong with that photo.',
    );
    const keepPending = Boolean((raw as { quality_reject?: boolean }).quality_reject);
    return {
      replies: errReplies,
      pendingOut: keepPending ? 'COLOR_ANALYSIS_IMAGE' : null,
    };
  }

  await clearHttpPendingFlow(prismaUserId);
  const intro = String(raw.compliment ?? '').trim();
  const replies = await buildRepliesFromColorTool(raw, user, intro);
  return { replies, pendingOut: null };
}

async function runVibeCheckOnMedia(
  prismaUserId: string,
  input: MessageInput,
  user: User | null,
  tonality: string,
): Promise<{ replies: HttpReplyPayload[]; pendingOut: string | null }> {
  const url = input.MediaUrl0;
  if (!url) {
    return {
      replies: await buildRepliesFromVibeTool(
        { error: 'Missing image URL — please upload again.' },
        user,
      ),
      pendingOut: 'VIBE_CHECK_IMAGE',
    };
  }
  const { data, mimeType } = await fetchImageAsBase64(url);
  const raw = await vibeCheck({
    userId: prismaUserId,
    imageBase64: data,
    mimeType,
    sourceImageUrl: url,
    tonality,
  });

  if ((raw as { error?: string }).error) {
    const msg = String((raw as { error?: string }).error);
    const errReplies = await buildRepliesFromVibeTool({ error: msg }, user, msg);
    return { replies: errReplies, pendingOut: 'VIBE_CHECK_IMAGE' };
  }

  await clearHttpPendingFlow(prismaUserId);
  const replies = await buildRepliesFromVibeTool(raw, user);
  return { replies, pendingOut: null };
}

export async function tryHandleHttpChatFlows(
  prismaUserId: string,
  input: MessageInput,
  user: User | null,
): Promise<
  { handled: true; replies: HttpReplyPayload[]; pending: string | null } | { handled: false }
> {
  const bp = input.ButtonPayload;
  const utterance = (input.Body || input.ButtonText || '').trim();
  const nMedia = numMediaOf(input);
  const guest = isGuestUser(user);

  const pending = await getHttpPendingFlow(prismaUserId);

  try {
    // --- Save color analysis (registered only meaningful) ---
    if (bp === 'save_color_analysis_yes') {
      const staged = await getStagedColorAnalysis(prismaUserId);
      if (!staged) {
        const replies = formatReplies(
          {
            text: 'There’s nothing queued to save — run a fresh color read first.',
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          { user },
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      await prisma.colorAnalysis.create({
        data: {
          userId: prismaUserId,
          skin_tone: staged.skin_tone,
          eye_color: staged.eye_color,
          hair_color: staged.hair_color,
          undertone: staged.undertone,
          compliment: staged.compliment,
          palette_name: staged.palette_name,
          palette_description: staged.palette_description,
          colors_suited: staged.colors_suited as Prisma.InputJsonValue,
          colors_to_wear: staged.colors_to_wear as Prisma.InputJsonValue,
          colors_to_avoid: staged.colors_to_avoid as Prisma.InputJsonValue,
        },
      });
      await prisma.user.update({
        where: { id: prismaUserId },
        data: { lastColorAnalysisAt: new Date() },
      });
      await invalidateContext(prismaUserId);
      await clearStagedColorAnalysis(prismaUserId);
      const replies = formatReplies(
        {
          text: 'Saved — I’ll remember this palette for your recommendations.',
          toolResults: [],
          products: [],
          colorAnalysis: null,
          vibeCheck: null,
        },
        { user },
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    if (bp === 'save_color_analysis_no') {
      await clearStagedColorAnalysis(prismaUserId);
      const replies = formatReplies(
        {
          text: 'No worries — I won’t save that run to your profile.',
          toolResults: [],
          products: [],
          colorAnalysis: null,
          vibeCheck: null,
        },
        { user },
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    // --- Fetch saved palette (text or button) ---
    if (
      wantsFetchSavedPalette(utterance, bp) &&
      !bp?.startsWith('tonality_') &&
      bp !== 'vibe_check'
    ) {
      if (guest) {
        const replies = formatReplies(
          {
            text: 'Saved palettes live on your Broadway profile. Sign in with a full account and run color analysis once, then you can fetch it anytime.',
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          { user },
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      await clearStagedColorAnalysis(prismaUserId);
      const row = await prisma.colorAnalysis.findFirst({
        where: { userId: prismaUserId },
        orderBy: { createdAt: 'desc' },
      });
      if (!row?.palette_name) {
        const replies = formatReplies(
          {
            text: 'You don’t have a saved palette yet. Tap Color analysis to do a read, or upload a clear selfie.',
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          { user },
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      const canonical = resolveSeasonalPalette(row.palette_name);
      if (!canonical || !isValidPalette(canonical)) {
        const replies = formatReplies(
          {
            text: 'Your saved palette record looks incomplete — try a fresh analysis.',
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          { user },
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      const paletteData = getPaletteData(canonical);
      const topColors = shuffleArray([...paletteData.topColors]);
      const twoColorCombos = shuffleArray(
        formatColorCombos(paletteData.twoColorCombos, paletteData.topColors),
      );
      await clearHttpPendingFlow(prismaUserId);
      const colorPayload = {
        palette_name: canonical,
        description: row.palette_description || paletteData.description,
        top_colors: topColors,
        two_color_combos: twoColorCombos,
        user_image_url: null as string | null,
      };
      const replies = await buildRepliesFromColorTool(
        colorPayload,
        user,
        'Here’s the palette I have on file for you.',
        { skipColorSavePrompt: true },
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    // --- Vibe check entry ---
    if (bp === 'vibe_check' || (wantsNewVibeCheck(utterance, bp) && !bp && nMedia === 0)) {
      await clearHttpPendingFlow(prismaUserId);
      await setHttpPendingFlow(prismaUserId, { type: 'TONALITY_SELECTION' });
      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text: 'Love it — before I roast-or-toast your fit, how should I talk to you?',
        },
        {
          reply_type: 'quick_reply',
          reply_text: 'Pick your stylist energy:',
          buttons: [
            { text: 'Savage honest', id: 'tonality_savage' },
            { text: 'Friendly stylist', id: 'tonality_friendly' },
            { text: 'Hype BFF', id: 'tonality_hype_bff' },
          ],
        },
      ];
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'TONALITY_SELECTION' };
    }

    // --- Tonality picked → request outfit image ---
    if (bp && resolveTonalityFromPayload(bp)) {
      const tone = resolveTonalityFromPayload(bp)!;
      await setHttpPendingFlow(prismaUserId, { type: 'VIBE_CHECK_IMAGE', tonality: tone });
      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text:
            'Perfect. Send a full outfit photo (mirror pic or full-body works). I’ll score fit, color harmony, and details.',
        },
        {
          reply_type: 'vibe_check_image_upload_request',
          reply_text: 'Upload your outfit photo when you’re ready.',
        },
      ];
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'VIBE_CHECK_IMAGE' };
    }

    // --- Pending: vibe check image ---
    if (pending.type === 'VIBE_CHECK_IMAGE' && nMedia > 0) {
      const repliesPack = await runVibeCheckOnMedia(prismaUserId, input, user, pending.tonality);
      await appendFlowHistory(prismaUserId, input, repliesPack.replies);
      return { handled: true, replies: repliesPack.replies, pending: repliesPack.pendingOut };
    }

    if (pending.type === 'VIBE_CHECK_IMAGE' && nMedia === 0 && !bp) {
      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text: 'I’m still waiting on that outfit photo — send an image to keep going.',
        },
        {
          reply_type: 'vibe_check_image_upload_request',
          reply_text: 'Tap attach and upload your outfit.',
        },
      ];
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'VIBE_CHECK_IMAGE' };
    }

    if (pending.type === 'TONALITY_SELECTION' && nMedia > 0 && !bp) {
      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text: 'Pick a tonality button first — then you can drop your outfit pic.',
        },
      ];
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'TONALITY_SELECTION' };
    }

    // --- Color analysis service entry (button always = new run) ---
    if (
      bp === 'color_analysis' ||
      (wantsNewColorAnalysis(utterance, bp) && !bp?.startsWith('tonality_'))
    ) {
      await clearStagedColorAnalysis(prismaUserId);
      await setHttpPendingFlow(prismaUserId, { type: 'COLOR_ANALYSIS_IMAGE' });

      if (nMedia > 0) {
        const pack = await runColorAnalysisOnMedia(prismaUserId, input, user);
        await appendFlowHistory(prismaUserId, input, pack.replies);
        return { handled: true, replies: pack.replies, pending: pack.pendingOut };
      }

      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text:
            'For the most accurate read, send a clear, front-facing selfie in natural-ish light. I’ll flag it if the photo isn’t usable.',
        },
        {
          reply_type: 'color_analysis_image_upload_request',
          reply_text: 'Upload a face photo to continue with color analysis.',
        },
      ];
      const buttons: { text: string; id: string }[] = [];
      if (!guest && (await userHasSavedColorAnalysis(prismaUserId))) {
        buttons.push({ text: 'Fetch my saved palette', id: 'color_analysis_fetch_saved' });
      }
      if (buttons.length) {
        replies.push({
          reply_type: 'quick_reply',
          reply_text: 'Already have a saved read on file?',
          buttons,
        });
      }
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'COLOR_ANALYSIS_IMAGE' };
    }

    // --- Pending: color analysis image ---
    if (pending.type === 'COLOR_ANALYSIS_IMAGE' && nMedia > 0) {
      const pack = await runColorAnalysisOnMedia(prismaUserId, input, user);
      await appendFlowHistory(prismaUserId, input, pack.replies);
      return { handled: true, replies: pack.replies, pending: pack.pendingOut };
    }

    if (pending.type === 'COLOR_ANALYSIS_IMAGE' && nMedia === 0 && !bp) {
      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text:
            'I’m ready when you are — upload a clear face photo so I can map your seasonal palette.',
        },
        {
          reply_type: 'color_analysis_image_upload_request',
          reply_text: 'Waiting on your selfie for color analysis.',
        },
      ];
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'COLOR_ANALYSIS_IMAGE' };
    }

    return { handled: false };
  } catch (err) {
    logger.error({ err, prismaUserId }, 'httpChatFlows failed');
    return { handled: false };
  }
}
