import type { ChatMessage } from './prompt';

export interface AiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  budgetMs?: number;
}

export const DEFAULT_AI_TIMEOUT_MS = 15_000;
// waitUntil work is cut off ~30s after the webhook response; leave time to send the message.
export const DEFAULT_AI_BUDGET_MS = 25_000;
const MIN_RETRY_MS = 5_000;

class AiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Gemini sometimes stalls a request; a fresh one usually answers fast. 4xx (incl. quota 429) won't fix itself.
function isTransient(err: unknown): boolean {
  if (err instanceof AiHttpError) return err.status >= 500;
  return err instanceof Error && err.name === 'TimeoutError';
}

const WRAPPED_IN_QUOTES = /^["'„“”«»]([\s\S]*)["'„“”«»]$/;

export function cleanOutput(text: string): string {
  const withoutThoughts = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  const quoted = WRAPPED_IN_QUOTES.exec(withoutThoughts);
  return (quoted ? quoted[1] : withoutThoughts).trim();
}

export async function generateRoast(messages: ChatMessage[], opts: AiOptions): Promise<string> {
  const body: Record<string, unknown> = { model: opts.model, messages, temperature: 1.0, max_tokens: 300 };
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_AI_BUDGET_MS);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  try {
    return await requestRoast(body, opts, timeoutMs);
  } catch (err) {
    const remainingMs = deadline - Date.now();
    if (!isTransient(err) || remainingMs < MIN_RETRY_MS) throw err;
    console.warn('Roast attempt failed, retrying', err);
    return await requestRoast(body, opts, Math.min(timeoutMs, remainingMs));
  }
}

async function requestRoast(body: Record<string, unknown>, opts: AiOptions, timeoutMs: number): Promise<string> {
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new AiHttpError(res.status, `AI request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const roast = cleanOutput(data.choices?.[0]?.message?.content ?? '');
  if (!roast) throw new Error(`AI returned an empty roast: ${JSON.stringify(data).slice(0, 300)}`);
  return roast;
}
