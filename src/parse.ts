import type { TgMessage, TgUser } from './types';

export interface RoastRequest {
  chatId: number;
  threadId?: number;
  replyToMessageId?: number;
  targetName: string;
  targetHandle?: string;
  context?: string;
}

export interface ParseOptions {
  command: string;
  botUsername: string;
}

export const MAX_CONTEXT_CHARS = 500;

// "/command" or "/command@BotName", followed by whitespace or end of text.
const COMMAND_RE = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/;

function userTarget(user: TgUser) {
  return {
    targetName: user.first_name || user.username || '?',
    targetHandle: user.username ? `@${user.username}` : undefined,
  };
}

export function parseCommand(msg: TgMessage, opts: ParseOptions): RoastRequest | null {
  const { text, from: sender } = msg;
  if (!text || !sender) return null;

  const match = COMMAND_RE.exec(text);
  if (!match) return null;
  const [prefix, command, addressee] = match;
  const bot = opts.botUsername.toLowerCase();
  if (command.toLowerCase() !== opts.command.toLowerCase()) return null;
  if (addressee && addressee.toLowerCase() !== bot) return null;

  const base = { chatId: msg.chat.id, threadId: msg.is_topic_message ? msg.message_thread_id : undefined };
  const self: RoastRequest = { ...base, ...userTarget(sender) };
  const isThisBot = (user: TgUser) => user.username?.toLowerCase() === bot;

  // In forum topics every message "replies" to the topic root; that is not a real reply.
  const reply = msg.reply_to_message;
  const isTopicRoot = msg.is_topic_message && reply?.message_id === msg.message_thread_id;
  if (reply?.from && !isTopicRoot) {
    if (isThisBot(reply.from)) return self;
    const context = (reply.text ?? reply.caption)?.trim().slice(0, MAX_CONTEXT_CHARS) || undefined;
    return { ...base, ...userTarget(reply.from), replyToMessageId: reply.message_id, context };
  }

  for (const entity of msg.entities ?? []) {
    if (entity.offset < prefix.length) continue;
    if (entity.type === 'text_mention' && entity.user) {
      return isThisBot(entity.user) ? self : { ...base, ...userTarget(entity.user) };
    }
    if (entity.type === 'mention') {
      const handle = text.slice(entity.offset, entity.offset + entity.length);
      const username = handle.replace(/^@/, '');
      return username.toLowerCase() === bot ? self : { ...base, targetName: username, targetHandle: handle };
    }
  }

  return self;
}
