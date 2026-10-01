import type { ChatMessage } from './prompt';

export interface AiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
  timeoutMs?: number;
}

export const DEFAULT_AI_TIMEOUT_MS = 10_000;

const WRAPPED_IN_QUOTES = /^["'„“”«»]([\s\S]*)["'„“”«»]$/;

export function cleanOutput(text: string): string {
  const withoutThoughts = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  const quoted = WRAPPED_IN_QUOTES.exec(withoutThoughts);
  return (quoted ? quoted[1] : withoutThoughts).trim();
}

export async function generateRoast(messages: ChatMessage[], opts: AiOptions): Promise<string> {
  const body: Record<string, unknown> = { model: opts.model, messages, temperature: 1.0, max_tokens: 300 };
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const roast = cleanOutput(data.choices?.[0]?.message?.content ?? '');
  if (!roast) throw new Error(`AI returned an empty roast: ${JSON.stringify(data).slice(0, 300)}`);
  return roast;
}
