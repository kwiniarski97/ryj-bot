import { generateRoast } from './ai';
import type { Config } from './config';
import { parseCommand, type RoastRequest } from './parse';
import { buildMessages } from './prompt';
import { sendMessage } from './telegram';
import type { TgUpdate } from './types';

// Commands older than this are a backlog Telegram redelivers after an outage; roasting them is stale.
export const MAX_COMMAND_AGE_SECONDS = 120;

// Names get inflected (Michał → Michale, Marek → Marku), so a short stem detects the name at the start.
function nameStem(name: string): string {
  return name.length > 3 ? name.slice(0, Math.max(3, name.length - 2)) : name;
}

export function addressRoast(req: RoastRequest, roast: string): string {
  if (req.replyToMessageId !== undefined) return roast;

  const { targetName: name, targetHandle: handle } = req;
  if (handle && roast.toLowerCase().startsWith(handle.toLowerCase())) return roast;

  const firstWord = (/^[\p{L}\p{N}_]+/u.exec(roast)?.[0] ?? '').toLowerCase();
  if (firstWord === name.toLowerCase()) return handle ? handle + roast.slice(firstWord.length) : roast;
  if (firstWord.startsWith(nameStem(name).toLowerCase())) return handle ? `${handle} ${roast}` : roast;
  return `${handle ?? name}, ${roast}`;
}

export async function handleUpdate(update: TgUpdate, cfg: Config, rng: () => number = Math.random): Promise<void> {
  const msg = update.message;
  if (!msg) return;
  if (msg.date !== undefined && Date.now() / 1000 - msg.date > MAX_COMMAND_AGE_SECONDS) return;
  if (cfg.allowedChatIds.length > 0 && !cfg.allowedChatIds.includes(msg.chat.id)) return;

  const req = parseCommand(msg, { command: cfg.command, botUsername: cfg.botUsername });
  if (!req) return;

  let roast: string;
  try {
    roast = await generateRoast(buildMessages(req, cfg, rng), {
      baseUrl: cfg.aiBaseUrl,
      apiKey: cfg.aiApiKey,
      model: cfg.aiModel,
      reasoningEffort: cfg.aiReasoningEffort,
    });
  } catch (err) {
    console.error('Roast generation failed', err);
    roast = cfg.fallbackText;
  }

  try {
    await sendMessage(cfg.telegramToken, {
      chatId: req.chatId,
      threadId: req.threadId,
      replyToMessageId: req.replyToMessageId,
      text: addressRoast(req, roast),
    });
  } catch (err) {
    console.error('Sending roast failed', err);
  }
}
