# zamknij-bot

Telegram bot: `/ryj` → AI-generated roast telling someone to shut up.
Cloudflare Worker + any OpenAI-compatible model (default: Gemini 3.5 Flash-Lite, free tier).

## Usage in a group

- Reply to someone's message with `/ryj` → roasts the author, using their message as material.
- `/ryj @username` → roasts that user.
- `/ryj` alone (or targeting the bot) → roasts you.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), note the token and username.
   If `/ryj` without `@BotName` is ignored in your group, run `/setprivacy` → Disable in BotFather
   (or make the bot a group admin) and re-add the bot to the group.
2. Get a Gemini API key at https://aistudio.google.com/apikey.
3. Install and configure:
   ```bash
   npm install
   # set BOT_USERNAME (and anything else) in wrangler.jsonc "vars"
   npx wrangler login
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # e.g. output of: openssl rand -hex 32
   npx wrangler secret put AI_API_KEY
   ```
4. Deploy and register the webhook:
   ```bash
   npm run deploy
   TELEGRAM_BOT_TOKEN=...:... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- ryj-bot.kw97.workers.dev
   ```

## Configuration (`wrangler.jsonc` → `vars`)

| Var | Default | Notes |
|---|---|---|
| `BOT_USERNAME` | — | Required, without `@` |
| `LANGUAGE` | `polski` | Output language (see note below) |
| `SPICINESS` | `very-hard` | `mild` \| `medium` \| `hard` \| `very-hard` |
| `COMMAND` | `ryj` | Command name without `/` |
| `AI_BASE_URL` | Gemini OpenAI endpoint | Any OpenAI-compatible `/chat/completions` base |
| `AI_MODEL` | `gemini-3.5-flash-lite` | |
| `AI_REASONING_EFFORT` | `low` | `""` = don't send it (some models reject it) |
| `ALLOWED_CHAT_IDS` | `""` (all) | Comma-separated chat ids |
| `SYSTEM_PROMPT` | `""` (built-in) | Full override; placeholders `{language}` `{spiciness}` `{angle}` |
| `FALLBACK_TEXT` | `Zamknij się. (AI odmówiło współpracy)` | Sent when the AI fails |

**Other languages:** the built-in prompt is written in Polish, because an English prompt made the model
drift into English. `LANGUAGE` alone usually works, but for reliable output in another language also set
`SYSTEM_PROMPT` written in that language (and translate `FALLBACK_TEXT`).

Switching provider = changing `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, e.g.
Groq `https://api.groq.com/openai/v1`, DeepSeek `https://api.deepseek.com`,
OpenRouter `https://openrouter.ai/api/v1`.

Gemini free tier allows 15 requests/minute per model; beyond that the bot answers with `FALLBACK_TEXT`.
On the free tier Google may use prompts (including quoted chat messages) to improve its models.

## Development

```bash
npm test             # unit tests
npm run typecheck
AI_API_KEY=... npm run try-roast -- "Marek" "co napisał"   # try the prompt without Telegram
```
