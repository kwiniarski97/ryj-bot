import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config';
import worker from '../src/index';

const env: Env = {
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'secret',
  AI_API_KEY: 'key',
  BOT_USERNAME: 'ZamknijBot',
};

function makeCtx() {
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException() {} };
  return { tasks, ctx: ctx as unknown as ExecutionContext };
}

function post(body: string, secret: string | null = 'secret') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request('https://bot.example/', { method: 'POST', headers, body });
}

const commandUpdate = JSON.stringify({
  update_id: 1,
  message: { message_id: 10, chat: { id: -100 }, from: { id: 2, is_bot: false, first_name: 'Kaśka' }, text: '/zamknij' },
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('api.telegram.org')
      ? new Response('{"ok":true}')
      : new Response(JSON.stringify({ choices: [{ message: { content: 'Kaśka, cicho.' } }] })),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('worker.fetch', () => {
  it('rejects non-POST with 405', async () => {
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request('https://bot.example/'), env, ctx);
    expect(res.status).toBe(405);
  });

  it.each([['wrong'], [null]])('rejects secret %j with 401 and does no work', async (secret) => {
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post(commandUpdate, secret), env, ctx);
    expect(res.status).toBe(401);
    expect(tasks).toHaveLength(0);
  });

  it('logs and returns 500 on invalid config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post(commandUpdate), { ...env, ALLOWED_CHAT_IDS: 'oops' }, ctx);
    expect(res.status).toBe(500);
    expect(tasks).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('config'), expect.any(Error));
    error.mockRestore();
  });

  it('acknowledges invalid JSON with 200 and does no work', async () => {
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post('not json'), env, ctx);
    expect(res.status).toBe(200);
    expect(tasks).toHaveLength(0);
  });

  it('returns 200 immediately and roasts in waitUntil', async () => {
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post(commandUpdate), env, ctx);
    expect(res.status).toBe(200);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    const telegramCall = fetchMock.mock.calls.find(([url]) => String(url).includes('api.telegram.org'));
    expect(JSON.parse(String(telegramCall?.[1]?.body))).toMatchObject({ chat_id: -100, text: 'Kaśka, cicho.' });
  });
});
