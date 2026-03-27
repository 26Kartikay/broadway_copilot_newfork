import { PendingType } from '@prisma/client';
import { Planner } from '../../lib/ai/planner';
import { GeneralIntent, GraphState, StylingIntent } from '../state';

const planner = new Planner();

/** Must match {@link supervisor} routing (first action). */
export const SUPERVISOR_SERVICE_ACTIONS = [
  'vibe_check',
  'color_analysis',
  'styling',
  'style_studio',
  'this_or_that',
  'skin_lab',
  'fashion_quiz',
] as const;

/** Sub-options after "Personal styling" — must reach handleStyling with stylingIntent set. */
const STYLING_SUB_BUTTONS: StylingIntent[] = ['occasion', 'vacation', 'pairing', 'suggest'];

/** Same regexes as routeGeneral.ts — infer greeting vs menu from free text. */
const GREETING_REGEX = /\b(hi|hello|hey|heya|yo|sup)\b/i;
const MENU_REGEX = /\b(help|menu|options?|what can you do\??)\b/i;

const TONALITY_BUTTON_IDS = ['hype_bff', 'friendly', 'savage'] as const;

/**
 * When the user types a clear service phrase (no button), force routing so the LLM planner
 * cannot send them to generic chat (e.g. "color analysis" → colorAnalysis node).
 */
function detectServiceSlugFromMessage(body: string): string | null {
  const t = body.trim();
  if (!t) return null;
  if (
    /\b(color analysis|seasonal (color|palette) analysis|analy[sz]e my colors|my color season|what'?s my palette|find my (best )?colors|undertone|warm or cool (undertone|tones))\b/i.test(
      t,
    )
  ) {
    return 'color_analysis';
  }
  if (/\b(vibe check|rate my outfit|outfit check|how('?s| is) this (fit|look|outfit))\b/i.test(t)) {
    return 'vibe_check';
  }
  if (/\b(style studio|build a look|capsule wardrobe)\b/i.test(t)) {
    return 'style_studio';
  }
  if (/\b(this or that|fashion quiz|skin lab)\b/i.test(t)) {
    if (/\bthis or that\b/i.test(t)) return 'this_or_that';
    if (/\bfashion (quiz|charades)\b/i.test(t)) return 'fashion_quiz';
    if (/\bskin lab\b/i.test(t)) return 'skin_lab';
  }
  if (/\b(personal styling|style (this|my) outfit|outfit for an? )\b/i.test(t)) {
    return 'styling';
  }
  return null;
}

function inferGeneralIntentFromBody(body: string): 'greeting' | 'menu' | null {
  const t = body.trim();
  if (!t) return null;
  if (MENU_REGEX.test(t)) return 'menu';
  if (GREETING_REGEX.test(t)) return 'greeting';
  return null;
}

/** Planner intent string that should receive a generalIntent + handleGeneral routing. */
function isPlannerGeneralFamily(plan: { intent: string }): boolean {
  const i = (plan.intent || '').toLowerCase();
  return i === 'general' || i === 'greeting' || i === 'menu' || i === 'chat';
}

/**
 * Planner node: Decides the course of action for the agent.
 * Quick-reply buttons send `ButtonPayload` so we route deterministically without relying on the LLM alone.
 * Sets `generalIntent` whenever we route to handleGeneral (main_menu) so handleGeneral branches can run.
 */
export async function planAction(state: GraphState): Promise<Partial<GraphState>> {
  const { input, conversationHistoryTextOnly, userProfile, traceBuffer } = state;
  const historyText = conversationHistoryTextOnly
    .map((m) => {
      const first = m.content?.[0];
      const text =
        first && first.type === 'text' ? first.text : '';
      return `${m.role}: ${text}`;
    })
    .join('\n');

  const profileText = JSON.stringify(userProfile || {}, null, 2);
  const payload = input.ButtonPayload?.trim()?.toLowerCase() ?? '';
  const bodyText = input.Body?.trim() ?? '';

  // Tonality picker from handleGeneral (not vibe-check pending tonality selection)
  if (
    payload &&
    (TONALITY_BUTTON_IDS as readonly string[]).includes(payload) &&
    state.pending !== PendingType.TONALITY_SELECTION
  ) {
    const plan = await planner.plan(
      `[User selected tonality: ${payload}] ${bodyText}`,
      historyText,
      profileText,
      traceBuffer,
    );
    return {
      plan: { ...plan, actions: ['main_menu'] },
      intent: 'general' as any,
      generalIntent: 'tonality',
      selectedTonality: payload,
    };
  }

  if (payload === 'main_menu' || payload === 'menu') {
    const plan = await planner.plan(
      `[User opened main menu] ${bodyText}`,
      historyText,
      profileText,
      traceBuffer,
    );
    return {
      plan: { ...plan, actions: ['main_menu'] },
      intent: 'menu' as any,
      generalIntent: 'menu',
    };
  }

  if (payload && STYLING_SUB_BUTTONS.includes(payload as StylingIntent)) {
    const sub = payload as StylingIntent;
    const plan = await planner.plan(
      `[User chose styling sub-service: ${sub}] ${bodyText}`,
      historyText,
      profileText,
      traceBuffer,
    );
    return {
      plan: { ...plan, actions: ['styling'] },
      intent: 'styling' as any,
      stylingIntent: sub,
    };
  }

  if (payload && (SUPERVISOR_SERVICE_ACTIONS as readonly string[]).includes(payload)) {
    const plan = await planner.plan(
      `[User selected service: ${payload}] ${bodyText}`,
      historyText,
      profileText,
      traceBuffer,
    );
    return {
      plan: { ...plan, actions: [payload] },
      intent: payload as any,
    };
  }

  const forcedSlug = detectServiceSlugFromMessage(bodyText);
  if (!payload && forcedSlug) {
    const plan = await planner.plan(
      `[User message should route to service: ${forcedSlug}] ${bodyText}`,
      historyText,
      profileText,
      traceBuffer,
    );
    return {
      plan: {
        ...plan,
        actions: [forcedSlug],
        response_style: plan.response_style === 'exploratory' ? 'concise' : plan.response_style,
      },
      intent: forcedSlug as any,
    };
  }

  let plan = await planner.plan(bodyText, historyText, profileText, traceBuffer);

  // Route generic planner output to handleGeneral with explicit generalIntent (greeting / menu / chat)
  if (!payload && plan.actions[0] === 'contextBuilder' && isPlannerGeneralFamily(plan)) {
    const inferred = inferGeneralIntentFromBody(bodyText);
    plan = { ...plan, actions: ['main_menu'] };
    const generalIntent: GeneralIntent =
      inferred === 'greeting' || inferred === 'menu' ? inferred : 'chat';
    return {
      plan,
      intent: plan.intent as any,
      generalIntent,
    };
  }

  let finalPlan = plan;
  if (finalPlan.actions[0] === 'menu') {
    finalPlan = { ...finalPlan, actions: ['main_menu'] };
  }

  const out: Partial<GraphState> = {
    plan: finalPlan,
    intent: finalPlan.intent as any,
  };

  if (finalPlan.actions[0] === 'main_menu') {
    const inferred = inferGeneralIntentFromBody(bodyText);
    out.generalIntent = (inferred ?? 'menu') as GeneralIntent;
  }

  return out;
}
