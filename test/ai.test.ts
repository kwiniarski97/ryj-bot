import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanOutput, generateRoast, type AiOptions } from '../src/ai';
import type { ChatMessage } from '../src/prompt';

const messages: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'Person: Marek' },
];
const opts: AiOptions = { baseUrl: 'https://ai.example/v1', apiKey: 'key', model: 'm', reasoningEffort: 'low' };

const completion = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('generateRoast', () => {
  it('sends an OpenAI-compatible chat completion request', async () => {
    const fetchMock = stubFetch(completion('Marek, zamknij się.'));
    await generateRoast(messages, opts);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ai.example/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer key', 'Content-Type': 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'm',
      messages,
      temperature: 1.0,
      max_tokens: 300,
      reasoning_effort: 'low',
    });
  });

  it('omits reasoning_effort when not configured', async () => {
    const fetchMock = stubFetch(completion('ok'));
    await generateRoast(messages, { ...opts, reasoningEffort: undefined });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty('reasoning_effort');
  });

  it('returns the cleaned roast', async () => {
    stubFetch(completion('  „Marek, zamknij się.”  '));
    await expect(generateRoast(messages, opts)).resolves.toBe('Marek, zamknij się.');
  });

  it('throws on non-2xx (Gemini returns errors as an array)', async () => {
    stubFetch(new Response('[{"error":{"code":404,"message":"model gone"}}]', { status: 404 }));
    await expect(generateRoast(messages, opts)).rejects.toThrow(/404.*model gone/);
  });

  it('throws when the model was blocked (content null)', async () => {
    stubFetch(completion(null));
    await expect(generateRoast(messages, opts)).rejects.toThrow(/empty/);
  });

  it('throws when the output is only whitespace or thoughts', async () => {
    stubFetch(completion('  <thought>hmm</thought>  '));
    await expect(generateRoast(messages, opts)).rejects.toThrow(/empty/);
  });
});

describe('cleanOutput', () => {
  it('strips <thought> blocks', () => {
    expect(cleanOutput('<thought>plan\nthings</thought>\nMarek, cicho.')).toBe('Marek, cicho.');
  });

  it('strips quotes wrapping the whole roast', () => {
    expect(cleanOutput('"Marek, cicho."')).toBe('Marek, cicho.');
    expect(cleanOutput('„Marek, cicho.”')).toBe('Marek, cicho.');
  });

  it('keeps quotes that are part of the roast', () => {
    expect(cleanOutput('Twoja „inwestycja” to żart.')).toBe('Twoja „inwestycja” to żart.');
    expect(cleanOutput('Twoja „inwestycja”')).toBe('Twoja „inwestycja”');
  });
});
