# zamknij-bot — design

## Goal

A Telegram bot for a friend group chat that, on command, generates a short, funny,
brutal AI roast telling a chosen person to shut up. Polish by default; language,
spiciness and command name configurable through env. Running cost ≈ $0.

## Provider decision (spike, 2026-10-01)

Tested the same Polish prompt via Gemini's OpenAI-compatible endpoint:

- `gemini-3.5-flash-lite` — ~1s, natural colloquial Polish, funny. **Chosen.**
  Rejects `reasoning_effort: "none"`; accepts `"low"` or omitted.
- `gemini-3.1-flash-lite` — 2–4s, milder, wordier. Viable alternative.
- `gemma-4-*` — unreliable via the OpenAI endpoint (leaked `<thought>`, empty output). Rejected.
- Workers AI — not tested (no wrangler login). Reachable later through its
  OpenAI-compatible REST endpoint by config change only.

Cost: free tier; paid ≈ $0.0001 per roast. Free-tier prompts may be used by Google
for training — acceptable for this use.

## Architecture

Cloudflare Worker (TypeScript), Telegram webhook, no framework, no storage.
One OpenAI-compatible chat-completions client (`fetch`), so any compatible provider
(Gemini, Groq, DeepSeek, OpenRouter, Workers AI REST) works via env.

```
Telegram ──POST update──▶ Worker fetch()
                            ├─ verify X-Telegram-Bot-Api-Secret-Token (else 401)
                            ├─ return 200 immediately
                            └─ ctx.waitUntil(handleUpdate)
                                 parse → buildPrompt → generateRoast → sendMessage
```

### Units

| File | Responsibility |
|---|---|
| `src/index.ts` | Worker entry: method/secret check, `waitUntil`, chat allowlist |
| `src/config.ts` | Read and validate env into a typed `Config` with defaults |
| `src/parse.ts` | Pure: Telegram message → `RoastRequest \| null` |
| `src/prompt.ts` | Pure: `RoastRequest` + config → chat messages |
| `src/ai.ts` | OpenAI-compatible call with timeout; returns text or throws |
| `src/telegram.ts` | `sendMessage` wrapper |
| `scripts/set-webhook.mjs` | Registers webhook URL + secret with Telegram |
| `scripts/try-roast.ts` | Dev tool: prints sample roasts from the real prompt/provider (no Telegram) |

### Command parsing (`parse.ts`)

Matches message text starting with `/<COMMAND>` optionally followed by
`@<BotUsername>` (case-insensitive). A command addressed to a different bot
(`/zamknij@OtherBot`) is ignored. Non-matching messages → `null`.

Target resolution, first match wins:

1. Message is a reply → target = `reply_to_message.from`; context =
   `reply_to_message.text ?? caption` (truncated to 500 chars).
   Reply target is anchored: bot replies to that message.
2. Argument has a `text_mention` entity → that user.
3. Argument has a `mention` entity / `@username` token → that username (no context).
4. No target → target = the sender ("self-roast" for not naming anyone).

If the resolved target is the bot itself → target becomes the sender.

`RoastRequest = { chatId, replyToMessageId?, targetName, targetHandle?, context? }`
where `targetName` is the first name (or username) and `targetHandle` is `@username`
when known.

### Prompt (`prompt.ts`)

System prompt (Polish, see below), instructing output in `LANGUAGE`:
- one short roast (max 2 sentences) telling the target to shut up, addressed by name;
- natural colloquial language, use the provided message as material when present;
- spiciness instruction per level:
  - `mild` — witty, no swearing;
  - `medium` — light swearing allowed, wit first;
  - `hard` — strong profanity allowed;
  - `very-hard` — no holding back, maximally brutal and vulgar;
- at every level: no attacks on race, ethnicity, religion, sexual orientation,
  gender identity, disability; no threats of violence;
- output only the roast, no quotes, no preamble.

- one comedic **angle** for this roast (see below).

User message: target name + optional context.

**Angle randomization.** Spike showed the model repeats near-identical roasts for
the same input. Each call picks one angle uniformly at random (injectable RNG for
tests) and adds it to the system prompt. Built-in list:
their message (only when context present), "their mum" (twoja stara), intelligence,
life choices, job/money, laziness, comparison to an animal or object, absurd hyperbole,
everyday-life situation. Body/appearance deliberately excluded.

**Prompt language.** The built-in prompt, spiciness texts and angles are **Polish**.
The first A/B test (Polish vs English system prompt) looked equal only because the
user message was Polish too. The live check during implementation (English prompt,
`Person: Kaśka`, no context) produced English/Irish-slang roasts in most runs, even with
the language repeated three times; the Polish prompt gave 10/10 Polish.
`LANGUAGE` is still inserted ("Piszesz wyłącznie w języku: {language}" plus a reminder
in the user message); for a non-Polish output, also set `SYSTEM_PROMPT` in that language.
The forbidden list also covers jokes about sexual violence and incest (one live output
went there).

**`SYSTEM_PROMPT` override.** When set, replaces the built-in system prompt entirely.
Placeholders substituted by code: `{language}`, `{spiciness}` (the level's
instruction text), `{angle}`. Unknown placeholders left as-is. The user message
(name + context) is unchanged.

### AI client (`ai.ts`)

POST `${AI_BASE_URL}/chat/completions` with `Authorization: Bearer AI_API_KEY`,
`model`, `messages`, `temperature: 1.0`, `max_tokens: 300`, and `reasoning_effort`
only when set. 10s timeout via `AbortSignal.timeout`. Strips `<thought>…</thought>`
blocks and surrounding quotes/whitespace. Empty result or non-2xx → throws.

### Output

- Reply case: `sendMessage` with `reply_parameters.message_id` = target message,
  text = roast.
- Otherwise: text = `<targetHandle ?? targetName>, <roast>` unless the roast already
  starts with the name/handle.
- Plain text (no parse_mode) to avoid escaping issues.

## Configuration

| Var | Kind | Default |
|---|---|---|
| `LANGUAGE` | var | `polski` |
| `SPICINESS` | var | `very-hard` (`mild\|medium\|hard\|very-hard`) |
| `COMMAND` | var | `zamknij` |
| `BOT_USERNAME` | var | — (required; for `/cmd@Bot` and self-target detection) |
| `AI_BASE_URL` | var | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `AI_MODEL` | var | `gemini-3.5-flash-lite` |
| `AI_REASONING_EFFORT` | var | `low` (empty = omit) |
| `ALLOWED_CHAT_IDS` | var | empty = all chats; comma-separated ids |
| `SYSTEM_PROMPT` | var | empty = built-in prompt; supports `{language}` `{spiciness}` `{angle}` |
| `FALLBACK_TEXT` | var | `Zamknij się. (AI odmówiło współpracy)` |
| `TELEGRAM_BOT_TOKEN` | secret | required |
| `TELEGRAM_WEBHOOK_SECRET` | secret | required |
| `AI_API_KEY` | secret | required |

Invalid `SPICINESS` → falls back to default and logs a warning.
Local dev: `.dev.vars` (gitignored), `.dev.vars.example` committed.

## Error handling

- Wrong method → 405; bad/missing secret header → 401; invalid JSON → 200 (ignored).
- Chat not in allowlist → ignored silently.
- AI failure/timeout/empty → send `FALLBACK_TEXT` (same reply/addressing rules), log error.
- Telegram `sendMessage` failure → log error, nothing else.
- All processing errors caught inside `waitUntil`; Telegram always gets 200 for valid requests.

## Testing

vitest, plain Node environment (units are pure or `fetch`-based, `fetch` mocked):
- `parse`: reply, text_mention, @mention, no target → sender, target = bot → sender,
  `/cmd@BotName`, `/cmd@OtherBot` ignored, non-command ignored, caption context, truncation.
- `prompt`: language inserted, each spiciness level, context included/omitted,
  angle chosen via injected RNG, "their message" angle never picked without context,
  `SYSTEM_PROMPT` override with placeholder substitution.
- `ai`: request shape (reasoning omitted when empty), thought stripping, non-2xx throws, empty throws.
- `index`: 405/401, allowlist, fallback on AI error, reply vs mention addressing.

Manual: one live run against Gemini with the real prompt (Polish quality check),
then deploy and test in a real group.

## Out of scope

Per-chat cooldowns, roast history/dedup, multiple simultaneous providers, inline mode.
