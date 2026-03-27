import z from 'zod';
import { ChatOpenAI } from './openai/chat_models';
import { StructuredOutputRunnable } from './core/structured_output_runnable';
import { SystemMessage, UserMessage } from './core/messages';
import { TraceBuffer } from '../../agent/tracing';

const toneEnum = z.enum(['friendly', 'premium', 'casual']);
const responseStyleEnum = z.enum(['natural', 'exploratory', 'concise']);

/** First routing key from planner → supervisor (see supervisor.ts). */
const SUPERVISOR_SLUGS = new Set([
  'vibe_check',
  'color_analysis',
  'styling',
  'style_studio',
  'this_or_that',
  'skin_lab',
  'fashion_quiz',
  'main_menu',
  'menu',
  'contextBuilder',
]);

function normalizeActionSlug(raw: string): string {
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  const aliases: Record<string, string> = {
    respond_greeting: 'contextBuilder',
    respond: 'contextBuilder',
    general: 'contextBuilder',
    chat: 'contextBuilder',
    greeting: 'contextBuilder',
    open_chat: 'contextBuilder',
    help: 'main_menu',
    mainmenu: 'main_menu',
    vibe: 'vibe_check',
    outfit_check: 'vibe_check',
    outfit: 'vibe_check',
    colors: 'color_analysis',
    seasonal: 'color_analysis',
    palette: 'color_analysis',
    color: 'color_analysis',
    personal_styling: 'styling',
    style_advice: 'styling',
    studio: 'style_studio',
    thisorthat: 'this_or_that',
    skin: 'skin_lab',
    skincare: 'skin_lab',
    quiz: 'fashion_quiz',
    charades: 'fashion_quiz',
    fashion_quiz: 'fashion_quiz',
  };
  const mapped = aliases[s] ?? s;
  if (mapped === 'menu') return 'main_menu';
  if (SUPERVISOR_SLUGS.has(mapped)) return mapped;
  return 'contextBuilder';
}

/** Maps common model aliases (e.g. singular `action`, `response_tone`) to our canonical shape. */
function normalizePlannerJson(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const o = data as Record<string, unknown>;

  const actions: string[] = [];
  if (Array.isArray(o.actions)) {
    for (const a of o.actions) actions.push(String(a));
  }
  if (typeof o.action === 'string') actions.push(o.action);
  if (Array.isArray(o.tools_services)) {
    for (const t of o.tools_services) actions.push(String(t));
  }
  const deduped = [...new Set(actions.map(normalizeActionSlug))];

  const should_proactively_suggest =
    typeof o.should_proactively_suggest === 'boolean'
      ? o.should_proactively_suggest
      : typeof o.proactive_suggestion === 'boolean'
        ? o.proactive_suggestion
        : false;

  const rawTone = o.tone ?? o.response_tone;
  const tone =
    typeof rawTone === 'string' && toneEnum.safeParse(rawTone).success ? rawTone : 'friendly';

  const rawStyle = o.response_style;
  const response_style =
    typeof rawStyle === 'string' && responseStyleEnum.safeParse(rawStyle).success
      ? rawStyle
      : 'natural';

  return {
    intent: typeof o.intent === 'string' ? o.intent : 'general',
    actions: deduped.length > 0 ? deduped : ['contextBuilder'],
    should_proactively_suggest,
    response_style,
    tone,
  };
}

export const PlannerOutputSchema = z.preprocess(
  normalizePlannerJson,
  z.object({
    intent: z.string(),
    actions: z.array(z.string()),
    should_proactively_suggest: z.boolean(),
    response_style: responseStyleEnum,
    tone: toneEnum,
  }),
);

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export class Planner {
  private runnable: StructuredOutputRunnable<PlannerOutput>;

  constructor() {
    const model = new ChatOpenAI({
      model: 'gpt-4o',
      temperature: 0,
    });
    this.runnable = new StructuredOutputRunnable(model, PlannerOutputSchema);
  }

  async plan(
    input: string,
    history: string,
    userProfile: string,
    traceBuffer: TraceBuffer,
    /** Must match the compiled graph node name (e.g. planAction) or a manually injected trace node. */
    traceNodeName: string = 'planAction',
  ): Promise<PlannerOutput> {
    const systemPrompt = new SystemMessage(`
You are a strategic planner for a premium personal stylist AI.
Your goal is to analyze the user's input and decide the best course of action.

USER PROFILE:
${userProfile}

CONVERSATION HISTORY:
${history}

TRIGGER RULES:
- If user mentions "color", "analysis", "palette", "seasonal" -> use "color_analysis".
- If user mentions "outfit", "look", "how do I look", "check" -> use "vibe_check".
- If user asks for "styling", "advice", "what to wear" -> use "styling".
- If user wants to "play", "game", "quiz" -> use "fashion_quiz".

ROLES:
- Detect the user's intent.
- Set \`actions\` to route the app. The FIRST element must be one of these exact slugs (underscores):
  vibe_check, color_analysis, styling, style_studio, this_or_that, skin_lab, fashion_quiz,
  main_menu (help / what can you do), or contextBuilder (general conversation / small talk / unclear).
- Additional entries in \`actions\` are optional follow-up steps.
- Decide if a proactive suggestion is needed.
- Set the tone and style for the response.

Output a single JSON object with EXACTLY these keys (no aliases):
- "intent": string
- "actions": string[] (first item = routing slug from the list above; use ["contextBuilder"] for generic chat)
- "should_proactively_suggest": boolean
- "response_style": "natural" | "exploratory" | "concise"
- "tone": "friendly" | "premium" | "casual"

STRICT JSON OUTPUT ONLY.
`);

    const userMessage = new UserMessage(input);

    return this.runnable.run(systemPrompt, [userMessage], traceBuffer, traceNodeName);
  }
}
