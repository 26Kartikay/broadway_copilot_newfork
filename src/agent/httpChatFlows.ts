import type { Gender, Prisma, User } from '@prisma/client';
import { formatColorCombos, shuffleArray } from '../data/colorAnalysisHelpers';
import { getPaletteData, isValidPalette, resolveSeasonalPalette } from '../data/seasonalPalettes';
import type { MessageInput } from '../lib/chat/types';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { getServerUrlBase } from '../utils/serverUrl';
import { isGuestUser } from '../utils/user';
import { formatReplies } from './formatReply';
import type { HttpReplyPayload } from './httpReplies';
import {
  appendToHistory,
  clearGuestCatalogGenderMix,
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

function needsGuestGenderPrompt(user: User | null, requestProfileName?: string | null): boolean {
  if (!isGuestUser(user, requestProfileName)) return false;
  return !user?.confirmedGender && !user?.inferredGender;
}

function getPalettePdfUrl(paletteName: string): string | null {
  const canonical = resolveSeasonalPalette(paletteName);
  if (!canonical || !isValidPalette(canonical)) return null;
  const pdfPath = getPaletteData(canonical).pdfPath.replace(/^\//, '');
  const baseUrl =
    getServerUrlBase() || `http://localhost:${Number.parseInt(process.env.PORT || '8080', 10)}`;
  return `${baseUrl}/${pdfPath}`;
}

function buildColorRecommendationPrompt(): HttpReplyPayload {
  return {
    reply_type: 'text',
    reply_text:
      'Do you want me to pull some recommendations for you based on your skin palette?',
  };
}

function wantsPreviousVibeCheckResult(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(what was|show me|get|fetch|see)\b.{0,20}\b(my|the)\b.{0,20}\b(vibe check|vibe score)\b/.test(t) ||
    /\bmy (last|previous|past) vibe (check|score|result)\b/.test(t) ||
    /\bvibe check result\b/.test(t)
  );
}

async function userHasSavedColorAnalysis(userId: string): Promise<boolean> {
  const row = await prisma.colorAnalysis.findFirst({ where: { userId }, select: { id: true } });
  return Boolean(row);
}

async function buildRepliesFromColorTool(
  color: Record<string, unknown>,
  user: User | null,
  introText?: string,
  opts?: { skipColorSavePrompt?: boolean; requestProfileName?: string | null | undefined },
): Promise<HttpReplyPayload[]> {
  const agentLike: AgentResult = {
    text: introText ?? String(color.compliment ?? '').trim(),
    toolResults: [{ toolName: 'analyze_color_season', ...color }],
    products: [],
    colorAnalysis: { toolName: 'analyze_color_season', ...color },
    vibeCheck: null,
  };
  const base = { user, requestProfileName: opts?.requestProfileName };
  const formatOpts =
    opts?.skipColorSavePrompt === true ? { ...base, skipColorSavePrompt: true as const } : base;
  return formatReplies(agentLike, formatOpts);
}

async function buildRepliesFromVibeTool(
  vc: Record<string, unknown>,
  user: User | null,
  introText?: string,
  opts?: { requestProfileName?: string | null | undefined },
): Promise<HttpReplyPayload[]> {
  const agentLike: AgentResult = {
    text: introText ?? String(vc.comment ?? '').trim(),
    toolResults: [{ toolName: 'vibe_check', ...vc }],
    products: [],
    colorAnalysis: null,
    vibeCheck: { toolName: 'vibe_check', ...vc },
  };
  return formatReplies(agentLike, { user, requestProfileName: opts?.requestProfileName });
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
  await appendToHistory(prismaUserId, [{ type: 'text', text: userLine }], assistantLine || '...');
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
        undefined,
        { requestProfileName: input.ProfileName },
      ),
      pendingOut: 'COLOR_ANALYSIS_IMAGE',
    };
  }
  const { data, mimeType } = await fetchImageAsBase64(url);
  const sourceImageUrl = input.MediaUrl0;
  const raw = await analyzeColorSeason({
    userId: prismaUserId,
    appUserId: user?.appUserId ?? input.WaId?.trim() ?? prismaUserId,
    imageBase64: data,
    mimeType,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  });

  if (raw.error) {
    const errReplies = await buildRepliesFromColorTool(
      { error: raw.error },
      user,
      typeof raw.error === 'string' ? raw.error : 'Something went wrong with that photo.',
      { requestProfileName: input.ProfileName },
    );
    const keepPending = Boolean((raw as { quality_reject?: boolean }).quality_reject);
    return {
      replies: errReplies,
      pendingOut: keepPending ? 'COLOR_ANALYSIS_IMAGE' : null,
    };
  }

  await clearHttpPendingFlow(prismaUserId);
  const intro = String(raw.compliment ?? '').trim();
  const replies: HttpReplyPayload[] = await buildRepliesFromColorTool(raw, user, intro, {
    requestProfileName: input.ProfileName,
  });
  const paletteName = String(raw.palette_name ?? raw.season ?? '');

  if (!isGuestUser(user, input.ProfileName)) {
    const staged = await getStagedColorAnalysis(prismaUserId);
    if (staged) {
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
    }
    replies.push({
      reply_type: 'quick_reply',
      reply_text: 'Would you like a detailed report on your color analysis?',
      buttons: [
        { text: 'Yes', id: 'color_report_yes' },
        { text: 'No', id: 'color_report_no' },
      ],
    });
  } else if (paletteName) {
    const pdfUrl = getPalettePdfUrl(paletteName);
    if (pdfUrl) {
      replies.push({
        reply_type: 'pdf',
        media_url: pdfUrl,
        reply_text: 'Here is your color palette guide PDF.',
      });
    }
    replies.push(buildColorRecommendationPrompt());
    if (needsGuestGenderPrompt(user, input.ProfileName)) {
      replies.push({
        reply_type: 'quick_reply',
        reply_text:
          'Just so I can pull the right picks — who are we styling today? 🛍',
        buttons: [
          { text: "Me (Women's)", id: 'guest_gender_female' },
          { text: "Me (Men's)", id: 'guest_gender_male' },
          { text: 'Someone else', id: 'guest_gender_skip' },
          { text: 'Skip', id: 'guest_gender_skip' },
        ],
      });
    }
  }
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
        undefined,
        { requestProfileName: input.ProfileName },
      ),
      pendingOut: 'VIBE_CHECK_IMAGE',
    };
  }
  const { data, mimeType } = await fetchImageAsBase64(url);
  const raw = await vibeCheck({
    userId: prismaUserId,
    appUserId: user?.appUserId ?? input.WaId?.trim() ?? prismaUserId,
    imageBase64: data,
    mimeType,
    sourceImageUrl: url,
    tonality,
  });

  if ((raw as { error?: string }).error) {
    const msg = String((raw as { error?: string }).error);
    const errReplies = await buildRepliesFromVibeTool({ error: msg }, user, msg, {
      requestProfileName: input.ProfileName,
    });
    return { replies: errReplies, pendingOut: 'VIBE_CHECK_IMAGE' };
  }

  await clearHttpPendingFlow(prismaUserId);
  const replies = await buildRepliesFromVibeTool(raw, user, undefined, {
    requestProfileName: input.ProfileName,
  });
  return { replies, pendingOut: null };
}

/** Explicit escape words — user clearly wants to exit the current flow. */
function isExplicitEscape(text: string): boolean {
  return /\b(never mind|nevermind|forget it|cancel|go back|stop|skip|not now|changed my mind|actually no|exit|quit|not interested|no thanks|take me back|let me out|abort|never mind)\b/i.test(
    text,
  );
}

/** Strong redirect — user is clearly asking for a different service while in an image-upload state. */
function isStrongRedirect(text: string): boolean {
  if (!text.trim()) return false;
  return (
    /\b(show me|find me|search|looking for|recommend|suggest|shop|browse|want to buy|help me find)\b/i.test(text) ||
    /\b(dress|shirt|top|jeans|pants|shoes|bag|jacket|skirt|blazer|outfit|style me|beauty|skincare|makeup)\b/i.test(text)
  );
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
  const guest = isGuestUser(user, input.ProfileName);
  const replyOpts = { user, requestProfileName: input.ProfileName };

  const pending = await getHttpPendingFlow(prismaUserId);

  try {
    // ── Flow escape ────────────────────────────────────────────────────────────
    if (pending.type !== 'NONE' && !bp) {
      const shouldEscape =
        isExplicitEscape(utterance) ||
        ((pending.type === 'COLOR_ANALYSIS_IMAGE' || pending.type === 'VIBE_CHECK_IMAGE') &&
          nMedia === 0 &&
          isStrongRedirect(utterance));

      if (shouldEscape) {
        await clearHttpPendingFlow(prismaUserId);
        logger.info({ prismaUserId, pendingType: pending.type, utterance: utterance.slice(0, 60) }, 'User escaped pending flow');
        return { handled: false };
      }
    }
    // ── /Flow escape ───────────────────────────────────────────────────────────

    // --- Guest gender capture ---
    if (bp === 'guest_gender_male' || bp === 'guest_gender_female' || bp === 'guest_gender_other') {
      if (guest) {
        const gender: Gender =
          bp === 'guest_gender_male' ? 'MALE' : bp === 'guest_gender_female' ? 'FEMALE' : 'OTHER';
        await prisma.user.update({
          where: { id: prismaUserId },
          data: { confirmedGender: gender },
        });
        await clearGuestCatalogGenderMix(prismaUserId);
        await invalidateContext(prismaUserId);
      }
      const replies = formatReplies(
        {
          text: "Got it — all picks from here will be styled just for you.",
          toolResults: [],
          products: [],
          colorAnalysis: null,
          vibeCheck: null,
        },
        replyOpts,
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    if (bp === 'guest_gender_skip') {
      const replies = formatReplies(
        {
          text: "No worries! Just tell me a bit about who you're shopping for and I'll pull the right picks.",
          toolResults: [],
          products: [],
          colorAnalysis: null,
          vibeCheck: null,
        },
        replyOpts,
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    // --- Color report (detailed PDF) ---
    if (bp === 'color_report_yes') {
      const staged = await getStagedColorAnalysis(prismaUserId);
      const pdfUrl = staged?.palette_name ? getPalettePdfUrl(staged.palette_name) : null;
      await clearStagedColorAnalysis(prismaUserId);
      const replies: HttpReplyPayload[] = [];
      if (pdfUrl) {
        replies.push({
          reply_type: 'pdf',
          media_url: pdfUrl,
          reply_text: 'Here is your color palette guide PDF.',
        });
      }
      replies.push(buildColorRecommendationPrompt());
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    if (bp === 'color_report_no') {
      await clearStagedColorAnalysis(prismaUserId);
      const replies: HttpReplyPayload[] = [buildColorRecommendationPrompt()];
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
            text: "Saved palettes live on your Broadway profile. Sign in with a full account and run color analysis once, then you can fetch it anytime.",
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          replyOpts,
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
            text: "You don't have a saved palette yet. Try a color analysis — just upload a clear selfie.",
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          replyOpts,
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      const canonical = resolveSeasonalPalette(row.palette_name);
      if (!canonical || !isValidPalette(canonical)) {
        const replies = formatReplies(
          {
            text: "Your saved palette record looks incomplete — try a fresh analysis.",
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          replyOpts,
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
        "Here is the palette I have on file for you.",
        { skipColorSavePrompt: true, requestProfileName: input.ProfileName },
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    // --- Fetch previous vibe check result ---
    if (wantsPreviousVibeCheckResult(utterance) && !bp && nMedia === 0) {
      if (guest) {
        const replies = formatReplies(
          {
            text: "Saved vibe checks live on your Broadway profile. Sign in with a full account to access your history.",
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          replyOpts,
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      const vcRow = await prisma.vibeCheck.findFirst({
        where: { userId: prismaUserId },
        orderBy: { createdAt: 'desc' },
      });
      if (!vcRow) {
        const replies = formatReplies(
          {
            text: "You haven't done a vibe check yet. Just say \"vibe check\" and I'll rate your fit!",
            toolResults: [],
            products: [],
            colorAnalysis: null,
            vibeCheck: null,
          },
          replyOpts,
        );
        await appendFlowHistory(prismaUserId, input, replies);
        return { handled: true, replies, pending: null };
      }
      const vcPayload = {
        comment: vcRow.comment,
        fit_silhouette_score: vcRow.fit_silhouette_score,
        fit_silhouette_explanation: vcRow.fit_silhouette_explanation,
        color_harmony_score: vcRow.color_harmony_score,
        color_harmony_explanation: vcRow.color_harmony_explanation,
        styling_details_score: vcRow.styling_details_score,
        styling_details_explanation: vcRow.styling_details_explanation,
        vibe_check_result: vcRow.overall_score,
        recommendations: vcRow.recommendations,
        user_image_url: null,
      };
      const replies = await buildRepliesFromVibeTool(
        vcPayload,
        user,
        "Here is your last vibe check result:",
        { requestProfileName: input.ProfileName },
      );
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: null };
    }

    // --- Vibe check entry — skip tonality selection, default to friendly ---
    if (bp === 'vibe_check' || (wantsNewVibeCheck(utterance, bp) && !bp && nMedia === 0)) {
      await clearHttpPendingFlow(prismaUserId);
      await setHttpPendingFlow(prismaUserId, { type: 'VIBE_CHECK_IMAGE', tonality: 'friendly' });
      const replies: HttpReplyPayload[] = [
        {
          reply_type: 'text',
          reply_text: "Send a full outfit photo (mirror pic or full-body works) and I will score your fit, color harmony, and details.",
        },
        {
          reply_type: 'vibe_check_image_upload_request',
          reply_text: "Upload your outfit photo when you are ready.",
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
          reply_text: "Still waiting on that outfit photo — send an image to keep going.",
        },
        {
          reply_type: 'vibe_check_image_upload_request',
          reply_text: "Tap attach and upload your outfit.",
        },
      ];
      await appendFlowHistory(prismaUserId, input, replies);
      return { handled: true, replies, pending: 'VIBE_CHECK_IMAGE' };
    }

    // --- Color analysis service entry ---
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
          reply_text: "For the most accurate read, send a clear, front-facing selfie in natural light. I will flag it if the photo is not usable.",
        },
        {
          reply_type: 'color_analysis_image_upload_request',
          reply_text: "Upload a face photo to continue with color analysis.",
        },
      ];
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
          reply_text: "Ready when you are — upload a clear face photo so I can map your seasonal palette.",
        },
        {
          reply_type: 'color_analysis_image_upload_request',
          reply_text: "Waiting on your selfie for color analysis.",
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
