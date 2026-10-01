export interface SendMessageOptions {
  chatId: number;
  text: string;
  threadId?: number;
  replyToMessageId?: number;
}

export async function sendMessage(token: string, opts: SendMessageOptions): Promise<void> {
  const body: Record<string, unknown> = { chat_id: opts.chatId, text: opts.text };
  if (opts.threadId !== undefined) body.message_thread_id = opts.threadId;
  if (opts.replyToMessageId !== undefined) {
    body.reply_parameters = { message_id: opts.replyToMessageId, allow_sending_without_reply: true };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}
