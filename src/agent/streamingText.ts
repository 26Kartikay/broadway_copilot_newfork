/**
 * Bridges assistant text chunks from the graph (generateResponse) to the HTTP SSE layer
 * so /api/chat/stream can emit `event: token` while the writer is still streaming.
 */

class TokenStreamController {
  private q: string[] = [];
  private wait: ((v: string | undefined) => void) | null = null;
  private closed = false;

  push(t: string): void {
    if (this.closed) return;
    if (this.wait) {
      const w = this.wait;
      this.wait = null;
      w(t);
    } else {
      this.q.push(t);
    }
  }

  close(): void {
    this.closed = true;
    if (this.wait) {
      this.wait(undefined);
      this.wait = null;
    }
  }

  async *read(): AsyncGenerator<string> {
    while (true) {
      if (this.q.length > 0) {
        yield this.q.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<string | undefined>((r) => {
        this.wait = r;
      });
      if (next === undefined) return;
      yield next;
    }
  }
}

const streams = new Map<string, TokenStreamController>();

function ensureController(id: string): TokenStreamController {
  let c = streams.get(id);
  if (!c) {
    c = new TokenStreamController();
    streams.set(id, c);
  }
  return c;
}

export function pushAssistantToken(messageId: string, chunk: string): void {
  ensureController(messageId).push(chunk);
}

export function closeAssistantTokenStream(messageId: string): void {
  const c = streams.get(messageId);
  if (c) {
    c.close();
    streams.delete(messageId);
  }
}

export async function* iterateAssistantTokens(messageId: string): AsyncGenerator<string> {
  const c = ensureController(messageId);
  yield* c.read();
}

/**
 * Push welcome / handler text in small chunks so SSE `token` events mirror agent-style typing.
 */
export async function streamAssistantTextNatural(
  messageId: string,
  text: string,
  opts?: { delayMs?: number },
): Promise<void> {
  const delay = opts?.delayMs ?? 16;
  const chunks = text.match(/\S+\s*|\s+/g) ?? [];
  for (const c of chunks) {
    if (!c) continue;
    pushAssistantToken(messageId, c);
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
