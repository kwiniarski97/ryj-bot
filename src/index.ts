import { loadConfig, type Config, type Env } from './config';
import { handleUpdate } from './handler';
import type { TgUpdate } from './types';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    let cfg: Config;
    try {
      cfg = loadConfig(env);
    } catch (err) {
      // Telegram will retry; stale commands from the backlog are skipped by the handler.
      console.error('Invalid config, fix wrangler vars/secrets', err);
      return new Response('Misconfigured', { status: 500 });
    }
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
