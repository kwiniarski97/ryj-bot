import { describe, expect, it } from 'vitest';
import { MAX_CONTEXT_CHARS, parseCommand } from '../src/parse';
import type { TgEntity, TgMessage, TgUser } from '../src/types';

const opts = { command: 'zamknij', botUsername: 'ZamknijBot' };
const kaska: TgUser = { id: 2, is_bot: false, first_name: 'Kaśka' };
const marek: TgUser = { id: 1, is_bot: false, first_name: 'Marek', username: 'marek_x' };
const bot: TgUser = { id: 99, is_bot: true, first_name: 'Zamknij', username: 'ZamknijBot' };

function msg(text: string, extra: Partial<TgMessage> = {}): TgMessage {
  return { message_id: 10, chat: { id: -100 }, from: kaska, text, ...extra };
}

function mention(text: string, handle: string): TgEntity {
  return { type: 'mention', offset: text.indexOf(handle), length: handle.length };
}

const replyTo = (extra: Partial<TgMessage> = {}): TgMessage => ({
  message_id: 5,
  chat: { id: -100 },
  from: marek,
  text: 'crypto zrobi x10',
  ...extra,
});

describe('parseCommand — matching', () => {
  it.each([
    'hej',
    '/start',
    '/zamknijcos',
    'hej /zamknij',
    '/zamknij@OtherBot',
  ])('ignores %j', (text) => {
    expect(parseCommand(msg(text), opts)).toBeNull();
  });

  it('ignores messages without text or sender', () => {
    expect(parseCommand(msg('/zamknij', { text: undefined }), opts)).toBeNull();
    expect(parseCommand(msg('/zamknij', { from: undefined }), opts)).toBeNull();
  });

  it.each(['/zamknij', '/Zamknij', '/zamknij@ZamknijBot', '/ZAMKNIJ@zamknijbot', '/zamknij jakiś tekst'])(
    'matches %j',
    (text) => {
      expect(parseCommand(msg(text), opts)).not.toBeNull();
    },
  );

  it('uses the configured command', () => {
    expect(parseCommand(msg('/cicho'), { ...opts, command: 'cicho' })).not.toBeNull();
    expect(parseCommand(msg('/zamknij'), { ...opts, command: 'cicho' })).toBeNull();
  });
});

describe('parseCommand — target', () => {
  it('roasts the author of the replied-to message with its text as context', () => {
    expect(parseCommand(msg('/zamknij', { reply_to_message: replyTo() }), opts)).toEqual({
      chatId: -100,
      threadId: undefined,
      replyToMessageId: 5,
      targetName: 'Marek',
      targetHandle: '@marek_x',
      context: 'crypto zrobi x10',
    });
  });

  it('uses caption as context when the replied message has no text', () => {
    const req = parseCommand(msg('/zamknij', { reply_to_message: replyTo({ text: undefined, caption: 'moje lambo' }) }), opts);
    expect(req?.context).toBe('moje lambo');
  });

  it('roasts without context when replying to a sticker/photo without caption', () => {
    const req = parseCommand(msg('/zamknij', { reply_to_message: replyTo({ text: undefined }) }), opts);
    expect(req).toMatchObject({ targetName: 'Marek', replyToMessageId: 5, context: undefined });
  });

  it(`truncates context to ${MAX_CONTEXT_CHARS} chars`, () => {
    const req = parseCommand(msg('/zamknij', { reply_to_message: replyTo({ text: 'a'.repeat(2000) }) }), opts);
    expect(req?.context).toHaveLength(MAX_CONTEXT_CHARS);
  });

  it('roasts the sender when replying to the bot itself', () => {
    const req = parseCommand(msg('/zamknij', { reply_to_message: replyTo({ from: bot }) }), opts);
    expect(req).toEqual({ chatId: -100, threadId: undefined, targetName: 'Kaśka', targetHandle: undefined });
  });

  it('roasts a text_mention user (user without username)', () => {
    const text = '/zamknij Marek';
    const req = parseCommand(
      msg(text, { entities: [{ type: 'bot_command', offset: 0, length: 8 }, { type: 'text_mention', offset: 9, length: 5, user: marek }] }),
      opts,
    );
    expect(req).toMatchObject({ targetName: 'Marek', targetHandle: '@marek_x' });
    expect(req?.replyToMessageId).toBeUndefined();
  });

  it('roasts an @mentioned username', () => {
    const text = '/zamknij @marek_x';
    const req = parseCommand(msg(text, { entities: [mention(text, '@marek_x')] }), opts);
    expect(req).toEqual({ chatId: -100, threadId: undefined, targetName: 'marek_x', targetHandle: '@marek_x' });
  });

  it('roasts the sender when the bot is mentioned as target', () => {
    const text = '/zamknij @zamknijbot';
    const req = parseCommand(msg(text, { entities: [mention(text, '@zamknijbot')] }), opts);
    expect(req?.targetName).toBe('Kaśka');
  });

  it('ignores a mention that is part of /cmd@Bot', () => {
    const text = '/zamknij@ZamknijBot';
    const req = parseCommand(msg(text, { entities: [{ type: 'bot_command', offset: 0, length: text.length }] }), opts);
    expect(req?.targetName).toBe('Kaśka');
  });

  it('roasts the sender when no target is given', () => {
    expect(parseCommand(msg('/zamknij'), opts)).toEqual({
      chatId: -100,
      threadId: undefined,
      targetName: 'Kaśka',
      targetHandle: undefined,
    });
  });
});

describe('parseCommand — forum topics', () => {
  it('does not treat the topic root as a reply, and keeps the thread id', () => {
    const topicRoot: TgMessage = { message_id: 77, chat: { id: -100 }, from: marek, text: undefined };
    const req = parseCommand(
      msg('/zamknij', { is_topic_message: true, message_thread_id: 77, reply_to_message: topicRoot }),
      opts,
    );
    expect(req).toEqual({ chatId: -100, threadId: 77, targetName: 'Kaśka', targetHandle: undefined });
  });

  it('handles a real reply inside a topic', () => {
    const req = parseCommand(
      msg('/zamknij', { is_topic_message: true, message_thread_id: 77, reply_to_message: replyTo() }),
      opts,
    );
    expect(req).toMatchObject({ threadId: 77, replyToMessageId: 5, targetName: 'Marek' });
  });
});
