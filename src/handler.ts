import { generateRoast } from './ai';
import type { Config } from './config';
import { parseCommand, type RoastRequest } from './parse';
import { buildMessages } from './prompt';
import { sendMessage } from './telegram';
import type { TgUpdate } from './types';

export function addressRoast(req: RoastRequest, roast: string): string {
  if (req.replyToMessageId !== undefined) return roast;

  const { targetName: name, targetHandle: handle } = req;
  const lower = roast.toLowerCase();
  if (handle && lower.startsWith(handle.toLowerCase())) return roast;
  if (lower.startsWith(name.toLowerCase())) return handle ? handle + roast.slice(name.length) : roast;
  return `${handle ?? name}, ${roast}`;
}

export async function handleUpdate(update: TgUpdate, cfg: Config, rng: () => number = Math.random): Promise<void> {
  const msg = update.message;
  if (!msg) return;
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
