import { ChatOpenAI } from './openai/chat_models';
import { SystemMessage, UserMessage, BaseMessage } from './core/messages';
import { TraceBuffer } from '../../agent/tracing';
import { PlannerOutput } from './planner';

export class Writer {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.45,
    });
  }

  async *write(
    input: string,
    plan: PlannerOutput,
    history: BaseMessage[],
    userProfile: string,
    traceBuffer: TraceBuffer,
    nodeName: string = 'writer'
  ): AsyncIterable<string> {
    const systemPrompt = new SystemMessage(`
You are a premium personal stylist. Be warm and clear — not verbose.

USER PROFILE:
${userProfile}

PLAN:
Intent: ${plan.intent}
Tone: ${plan.tone}
Style: ${plan.response_style}

LENGTH & VOICE:
- Default: 2–4 short sentences. Never write long paragraphs unless the user explicitly asked for depth.
- No filler chains: avoid "hmm", "let's think", "on second thought", "it feels like", "so much potential" unless the user asked for that vibe.
- One main point or one question per reply; end there.
- If Style is "concise": at most 2–3 sentences.
- If Style is "exploratory": still stay under ~6 sentences.
- Be ${plan.tone}. Match ${plan.response_style}.

Do NOT output JSON. Natural text only.
`);

    const msgs = [...history, new UserMessage(input)];

    yield* this.model.stream(systemPrompt, msgs, traceBuffer, nodeName);
  }
}
