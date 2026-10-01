import { loadConfig, type Env } from './config';
import { handleUpdate } from './handler';
import type { TgUpdate } from './types';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const cfg = loadConfig(env);
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== cfg.webhookSecret) {
      return new Response('Unauthorized', { status: 401 });
    }

    let update: TgUpdate;
    try {
      update = await request.json();
    } catch {
      return new Response('ok');
    }

    // Answer Telegram right away so it never retries; roast in the background.
    ctx.waitUntil(handleUpdate(update, cfg).catch((err) => console.error('handleUpdate crashed', err)));
    return new Response('ok');
  },
} satisfies ExportedHandler<Env>;
