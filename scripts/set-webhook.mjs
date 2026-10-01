// Registers the Worker URL as the bot's webhook.
// Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- https://zamknij-bot.<you>.workers.dev
const [url] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!url || !token || !secret) {
  console.error('Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- <worker-url>');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }),
});
const data = await res.json();
console.log(data);
if (!data.ok) process.exit(1);
