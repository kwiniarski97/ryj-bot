import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type Env } from '../src/config';
import { addressRoast, handleUpdate } from '../src/handler';
import type { TgMessage, TgUpdate } from '../src/types';

const env: Env = {
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'secret',
  AI_API_KEY: 'key',
  BOT_USERNAME: 'ZamknijBot',
};
const cfg = loadConfig(env);

const marek = { id: 1, is_bot: false, first_name: 'Marek', username: 'marek_x' };
const kaska = { id: 2, is_bot: false, first_name: 'Kaśka' };

function update(message: Partial<TgMessage>): TgUpdate {
  return { update_id: 1, message: { message_id: 10, chat: { id: -100 }, from: kaska, text: '/zamknij', ...message } };
}

const completion = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

let sent: Record<string, unknown>[];
let aiResponse: () => Response;
let telegramResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sent = [];
  aiResponse = () => completion('Marek, zamknij się.');
  telegramResponse = () => new Response('{"ok":true}', { status: 200 });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://api.telegram.org/bottg-token/sendMessage')) {
      sent.push(JSON.parse(String(init?.body)));
      return telegramResponse();
    }
    return aiResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleUpdate', () => {
  it('replies to the target message with the roast', async () => {
    await handleUpdate(update({ reply_to_message: { message_id: 5, chat: { id: -100 }, from: marek, text: 'x10' } }), cfg);
    expect(sent).toEqual([
      {
        chat_id: -100,
        text: 'Marek, zamknij się.',
        reply_parameters: { message_id: 5, allow_sending_without_reply: true },
      },
    ]);
  });

  it('addresses a mentioned user by handle', async () => {
    const text = '/zamknij @marek_x';
    aiResponse = () => completion('Zamknij się, geniuszu.');
    await handleUpdate(update({ text, entities: [{ type: 'mention', offset: 9, length: 8 }] }), cfg);
    expect(sent).toEqual([{ chat_id: -100, text: '@marek_x, Zamknij się, geniuszu.' }]);
  });

  it('sends the fallback text when the AI fails', async () => {
    aiResponse = () => new Response('boom', { status: 500 });
    await handleUpdate(update({}), cfg);
    expect(sent).toEqual([{ chat_id: -100, text: `Kaśka, ${cfg.fallbackText}` }]);
    expect(console.error).toHaveBeenCalled();
  });

  it('sends the fallback text when the AI response was blocked', async () => {
    aiResponse = () => completion(null);
    await handleUpdate(update({}), cfg);
    expect(sent[0].text).toBe(`Kaśka, ${cfg.fallbackText}`);
  });

  it('posts into the forum topic the command came from', async () => {
    await handleUpdate(update({ is_topic_message: true, message_thread_id: 77 }), cfg);
    expect(sent[0]).toMatchObject({ chat_id: -100, message_thread_id: 77 });
  });

  it('ignores chats outside the allowlist', async () => {
    await handleUpdate(update({}), { ...cfg, allowedChatIds: [-999] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores non-command messages and updates without a message', async () => {
    await handleUpdate(update({ text: 'siema' }), cfg);
    await handleUpdate({ update_id: 2 }, cfg);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when Telegram rejects the message', async () => {
    telegramResponse = () => new Response('{"ok":false}', { status: 400 });
    await expect(handleUpdate(update({}), cfg)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('addressRoast', () => {
  const mention = { chatId: 1, targetName: 'Marek', targetHandle: '@marek_x' };

  it('leaves reply roasts unchanged', () => {
    expect(addressRoast({ ...mention, replyToMessageId: 5 }, 'Cicho.')).toBe('Cicho.');
  });

  it('replaces a leading name with the handle', () => {
    expect(addressRoast(mention, 'Marek, cicho.')).toBe('@marek_x, cicho.');
  });

  it('leaves a roast starting with the handle unchanged', () => {
    expect(addressRoast(mention, '@marek_x, cicho.')).toBe('@marek_x, cicho.');
  });

  it('keeps a leading name when there is no handle', () => {
    expect(addressRoast({ chatId: 1, targetName: 'Kaśka' }, 'kaśka, cicho.')).toBe('kaśka, cicho.');
  });

  it('prefixes handle or name otherwise', () => {
    expect(addressRoast(mention, 'Cicho.')).toBe('@marek_x, Cicho.');
    expect(addressRoast({ chatId: 1, targetName: 'Kaśka' }, 'Cicho.')).toBe('Kaśka, Cicho.');
  });
});
