# zamknij-bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker Telegram bot that answers `/zamknij` with a short AI-generated roast telling the target to shut up, in a configurable language and spiciness.

**Architecture:** Telegram webhook → Worker verifies the secret header, returns 200, and processes in `ctx.waitUntil`: parse command → build prompt (random comedic angle) → OpenAI-compatible chat completion (Gemini by default) → `sendMessage`. Pure modules (`parse`, `prompt`) are separate from I/O modules (`ai`, `telegram`), glued by `handler`. No storage, no framework.

**Tech Stack:** TypeScript 7, Cloudflare Workers (wrangler 4), vitest 5 (Node environment, global `fetch` stubbed), `@cloudflare/workers-types`.

**Spec:** `docs/superpowers/specs/2026-10-01-zamknij-bot-design.md`

## Global Constraints

- No runtime dependencies. Dev dependencies only: `wrangler`, `typescript`, `vitest`, `@cloudflare/workers-types`.
- All HTTP via global `fetch`; tests stub it with `vi.stubGlobal('fetch', …)` and `vi.unstubAllGlobals()` in `afterEach`.
- Defaults (verbatim from spec): `LANGUAGE=polski`, `SPICINESS=very-hard`, `COMMAND=zamknij`, `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_MODEL=gemini-3.5-flash-lite`, `AI_REASONING_EFFORT=low` (empty = omit), `FALLBACK_TEXT=Zamknij się. (AI odmówiło współpracy)`.
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `AI_API_KEY`; required var: `BOT_USERNAME`.
- AI request: `temperature: 1.0`, `max_tokens: 300`, 10 s timeout.
- Context from replied message truncated to 500 chars.
- Telegram messages sent as plain text (no `parse_mode`).
- At every spiciness level the prompt forbids attacks on race, ethnicity, religion, sexual orientation, gender identity, disability, and threats of violence. Angles never include body/appearance.
- Secrets never committed: `.dev.vars` is gitignored.

## Review Focus

1. **Forum topics** — in a topic, every message has `reply_to_message` = the topic root; `/zamknij` there must not roast the topic creator, and the bot's answer must land in the same topic (`message_thread_id`). Pinned in Task 2 and Task 5.
2. **Gemini safety block** — HTTP 200 with `content: null` must produce the fallback text, not a crash or an empty message. Pinned in Task 4 and Task 5.
3. **Command lookalikes** — `/zamknijcos`, `hej /zamknij`, `/zamknij@OtherBot` must be ignored; `/Zamknij@zamknijbot` (any case) must work. Pinned in Task 2.
4. **Reply to a non-text message** (sticker, photo without caption) — roast without context, no crash. Pinned in Task 2.
5. **Typo in `ALLOWED_CHAT_IDS`** — must fail loudly, never silently become "allow all chats". Pinned in Task 1.

---

### Task 1: Project scaffold and config

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `.gitignore`, `.dev.vars.example`
- Create: `src/types.ts`, `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `TgUser`, `TgEntity`, `TgMessage`, `TgUpdate`
  - `src/config.ts`: `type Spiciness = 'mild' | 'medium' | 'hard' | 'very-hard'`, `SPICINESS_LEVELS`, `interface Env`, `interface Config`, `DEFAULTS`, `loadConfig(env: Env): Config`

- [ ] **Step 1: Create project files**

`package.json`:
```json
{
  "name": "zamknij-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "set-webhook": "node scripts/set-webhook.mjs",
    "try-roast": "npx --yes tsx scripts/try-roast.ts"
  }
}
```

Then install dev deps:
```bash
npm i -D wrangler typescript vitest @cloudflare/workers-types
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

`wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "zamknij-bot",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "observability": { "enabled": true },
  // Secrets (set with `npx wrangler secret put <NAME>`):
  //   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, AI_API_KEY
  "vars": {
    "BOT_USERNAME": "CHANGE_ME_bot",
    "LANGUAGE": "polski",
    "SPICINESS": "very-hard", // mild | medium | hard | very-hard
    "COMMAND": "zamknij",
    "AI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai",
    "AI_MODEL": "gemini-3.5-flash-lite",
    "AI_REASONING_EFFORT": "low", // "" = don't send the parameter
    "ALLOWED_CHAT_IDS": "", // comma-separated chat ids; "" = all chats
    "SYSTEM_PROMPT": "", // "" = built-in; placeholders: {language} {spiciness} {angle}
    "FALLBACK_TEXT": "Zamknij się. (AI odmówiło współpracy)"
  }
}
```

If `wrangler` later complains the compatibility date is in the future for its runtime, lower it to the date it suggests.

`.gitignore`:
```
node_modules/
.wrangler/
.dev.vars
```

`.dev.vars.example`:
```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=generate-with-openssl-rand-hex-32
AI_API_KEY=your-gemini-api-key
```

`src/types.ts`:
```ts
// Minimal subset of the Telegram Bot API types used by the bot.

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TgEntity {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  message_thread_id?: number;
  is_topic_message?: boolean;
  reply_to_message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}
```

- [ ] **Step 2: Write the failing config test**

`test/config.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, loadConfig, type Env } from '../src/config';

const base: Env = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_WEBHOOK_SECRET: 'secret',
  AI_API_KEY: 'key',
  BOT_USERNAME: 'ZamknijBot',
};

afterEach(() => vi.restoreAllMocks());

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      telegramToken: 'token',
      webhookSecret: 'secret',
      aiApiKey: 'key',
      botUsername: 'ZamknijBot',
      language: 'polski',
      spiciness: 'very-hard',
      command: 'zamknij',
      aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      aiModel: 'gemini-3.5-flash-lite',
      aiReasoningEffort: 'low',
      allowedChatIds: [],
      systemPrompt: undefined,
      fallbackText: DEFAULTS.fallbackText,
    });
  });

  it.each(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'AI_API_KEY', 'BOT_USERNAME'] as const)(
    'throws when %s is missing or blank',
    (key) => {
      expect(() => loadConfig({ ...base, [key]: undefined })).toThrow(key);
      expect(() => loadConfig({ ...base, [key]: '  ' })).toThrow(key);
    },
  );

  it('normalizes @bot, /command and trailing slash in base url', () => {
    const cfg = loadConfig({
      ...base,
      BOT_USERNAME: '@ZamknijBot',
      COMMAND: '/cicho',
      AI_BASE_URL: 'https://api.example.com/v1/',
    });
    expect(cfg.botUsername).toBe('ZamknijBot');
    expect(cfg.command).toBe('cicho');
    expect(cfg.aiBaseUrl).toBe('https://api.example.com/v1');
  });

  it('treats empty AI_REASONING_EFFORT as "omit"', () => {
    expect(loadConfig({ ...base, AI_REASONING_EFFORT: '' }).aiReasoningEffort).toBeUndefined();
    expect(loadConfig({ ...base, AI_REASONING_EFFORT: 'medium' }).aiReasoningEffort).toBe('medium');
  });

  it('treats empty optional vars as defaults', () => {
    const cfg = loadConfig({ ...base, LANGUAGE: '', SYSTEM_PROMPT: '', FALLBACK_TEXT: '' });
    expect(cfg.language).toBe('polski');
    expect(cfg.systemPrompt).toBeUndefined();
    expect(cfg.fallbackText).toBe(DEFAULTS.fallbackText);
  });

  it('accepts every spiciness level', () => {
    for (const level of ['mild', 'medium', 'hard', 'very-hard']) {
      expect(loadConfig({ ...base, SPICINESS: level }).spiciness).toBe(level);
    }
  });

  it('falls back to default spiciness on invalid value and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadConfig({ ...base, SPICINESS: 'nuclear' }).spiciness).toBe('very-hard');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('parses ALLOWED_CHAT_IDS', () => {
    expect(loadConfig({ ...base, ALLOWED_CHAT_IDS: '-1001234, 42 ,' }).allowedChatIds).toEqual([-1001234, 42]);
  });

  it('throws on invalid ALLOWED_CHAT_IDS instead of allowing all chats', () => {
    expect(() => loadConfig({ ...base, ALLOWED_CHAT_IDS: '-100abc' })).toThrow('ALLOWED_CHAT_IDS');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config`.

- [ ] **Step 4: Implement `src/config.ts`**

```ts
export const SPICINESS_LEVELS = ['mild', 'medium', 'hard', 'very-hard'] as const;
export type Spiciness = (typeof SPICINESS_LEVELS)[number];

export interface Env {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  AI_API_KEY?: string;
  BOT_USERNAME?: string;
  LANGUAGE?: string;
  SPICINESS?: string;
  COMMAND?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_REASONING_EFFORT?: string;
  ALLOWED_CHAT_IDS?: string;
  SYSTEM_PROMPT?: string;
  FALLBACK_TEXT?: string;
}

export interface Config {
  telegramToken: string;
  webhookSecret: string;
  aiApiKey: string;
  botUsername: string;
  language: string;
  spiciness: Spiciness;
  command: string;
  aiBaseUrl: string;
  aiModel: string;
  aiReasoningEffort?: string;
  allowedChatIds: number[];
  systemPrompt?: string;
  fallbackText: string;
}

export const DEFAULTS = {
  language: 'polski',
  spiciness: 'very-hard' as Spiciness,
  command: 'zamknij',
  aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  aiModel: 'gemini-3.5-flash-lite',
  aiReasoningEffort: 'low',
  fallbackText: 'Zamknij się. (AI odmówiło współpracy)',
};

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function required(env: Env, key: keyof Env): string {
  const value = optional(env[key]);
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}

function parseSpiciness(value: string | undefined): Spiciness {
  const v = optional(value);
  if (!v) return DEFAULTS.spiciness;
  if ((SPICINESS_LEVELS as readonly string[]).includes(v)) return v as Spiciness;
  console.warn(`Invalid SPICINESS "${v}", using "${DEFAULTS.spiciness}"`);
  return DEFAULTS.spiciness;
}

function parseChatIds(value: string | undefined): number[] {
  const parts = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.map((part) => {
    const id = Number(part);
    if (!Number.isInteger(id)) throw new Error(`Invalid chat id in ALLOWED_CHAT_IDS: "${part}"`);
    return id;
  });
}

export function loadConfig(env: Env): Config {
  return {
    telegramToken: required(env, 'TELEGRAM_BOT_TOKEN'),
    webhookSecret: required(env, 'TELEGRAM_WEBHOOK_SECRET'),
    aiApiKey: required(env, 'AI_API_KEY'),
    botUsername: required(env, 'BOT_USERNAME').replace(/^@/, ''),
    language: optional(env.LANGUAGE) ?? DEFAULTS.language,
    spiciness: parseSpiciness(env.SPICINESS),
    command: (optional(env.COMMAND) ?? DEFAULTS.command).replace(/^\//, ''),
    aiBaseUrl: (optional(env.AI_BASE_URL) ?? DEFAULTS.aiBaseUrl).replace(/\/+$/, ''),
    aiModel: optional(env.AI_MODEL) ?? DEFAULTS.aiModel,
    aiReasoningEffort:
      env.AI_REASONING_EFFORT === undefined ? DEFAULTS.aiReasoningEffort : optional(env.AI_REASONING_EFFORT),
    allowedChatIds: parseChatIds(env.ALLOWED_CHAT_IDS),
    systemPrompt: optional(env.SYSTEM_PROMPT),
    fallbackText: optional(env.FALLBACK_TEXT) ?? DEFAULTS.fallbackText,
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/config.test.ts && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.jsonc .gitignore .dev.vars.example src/types.ts src/config.ts test/config.test.ts
git commit -m "Scaffold worker project and env config"
```

---

### Task 2: Command parsing

**Files:**
- Create: `src/parse.ts`
- Test: `test/parse.test.ts`

**Interfaces:**
- Consumes: `TgMessage`, `TgUser` from `src/types.ts`
- Produces:
  ```ts
  interface RoastRequest {
    chatId: number;
    threadId?: number;          // set when the command came from a forum topic
    replyToMessageId?: number;  // set only when roasting the author of a replied-to message
    targetName: string;         // first name, or username without @
    targetHandle?: string;      // "@username" when known
    context?: string;           // replied message text/caption, ≤ 500 chars
  }
  interface ParseOptions { command: string; botUsername: string }
  const MAX_CONTEXT_CHARS = 500;
  function parseCommand(msg: TgMessage, opts: ParseOptions): RoastRequest | null
  ```

Rules (from spec): command must be at the very start, optionally `@<botUsername>` (case-insensitive); addressed to another bot → `null`. Target: reply author (not when the "reply" is just the forum-topic root) → `text_mention` entity → `mention` entity → the sender. Target equal to the bot → the sender.

- [ ] **Step 1: Write the failing tests**

`test/parse.test.ts`:
```ts
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
    expect(req).toMatchObject({ targetName: 'Marek', targetHandle: '@marek_x', replyToMessageId: undefined });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/parse.test.ts`
Expected: FAIL — cannot resolve `../src/parse`.

- [ ] **Step 3: Implement `src/parse.ts`**

```ts
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
```

Note: Telegram entity offsets are UTF-16 code units, which is what JS `slice` uses — no conversion needed.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/parse.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts test/parse.test.ts
git commit -m "Parse /zamknij command and resolve roast target"
```

---

### Task 3: Prompt builder with random angle

**Files:**
- Create: `src/prompt.ts`
- Test: `test/prompt.test.ts`

**Interfaces:**
- Consumes: `Config`, `Spiciness` from `src/config.ts`; `RoastRequest` from `src/parse.ts`
- Produces:
  ```ts
  interface ChatMessage { role: 'system' | 'user'; content: string }
  const SPICINESS_INSTRUCTIONS: Record<Spiciness, string>;
  const MESSAGE_ANGLE: string;
  const GENERAL_ANGLES: readonly string[];
  const DEFAULT_SYSTEM_PROMPT: string;
  function pickAngle(hasContext: boolean, rng: () => number): string
  function buildMessages(
    req: RoastRequest,
    cfg: Pick<Config, 'language' | 'spiciness' | 'systemPrompt'>,
    rng?: () => number, // defaults to Math.random
  ): ChatMessage[]
  ```

- [ ] **Step 1: Write the failing tests**

`test/prompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import type { RoastRequest } from '../src/parse';
import {
  buildMessages,
  DEFAULT_SYSTEM_PROMPT,
  GENERAL_ANGLES,
  MESSAGE_ANGLE,
  pickAngle,
  SPICINESS_INSTRUCTIONS,
} from '../src/prompt';

const cfg: Pick<Config, 'language' | 'spiciness' | 'systemPrompt'> = { language: 'polski', spiciness: 'very-hard' };
const withContext: RoastRequest = { chatId: 1, targetName: 'Marek', context: 'crypto zrobi x10' };
const noContext: RoastRequest = { chatId: 1, targetName: 'Kaśka' };

describe('pickAngle', () => {
  it('can pick the message angle only when there is context', () => {
    expect(pickAngle(true, () => 0)).toBe(MESSAGE_ANGLE);
    for (let i = 0; i < 100; i++) {
      expect(pickAngle(false, () => i / 100)).not.toBe(MESSAGE_ANGLE);
    }
  });

  it('covers the whole list and never goes out of bounds', () => {
    expect(pickAngle(false, () => 0)).toBe(GENERAL_ANGLES[0]);
    expect(pickAngle(false, () => 0.999999)).toBe(GENERAL_ANGLES.at(-1));
    expect(pickAngle(false, () => 1)).toBe(GENERAL_ANGLES.at(-1));
  });

  it('never suggests appearance or body', () => {
    for (const angle of [MESSAGE_ANGLE, ...GENERAL_ANGLES]) {
      expect(angle).not.toMatch(/look|body|weight|appearance|face/i);
    }
  });
});

describe('buildMessages', () => {
  it('fills the default prompt with language, spiciness and angle', () => {
    const [system] = buildMessages(noContext, cfg, () => 0);
    expect(system.role).toBe('system');
    expect(system.content).toContain('polski');
    expect(system.content).toContain(SPICINESS_INSTRUCTIONS['very-hard']);
    expect(system.content).toContain(GENERAL_ANGLES[0]);
    expect(system.content).not.toMatch(/\{\w+\}/);
  });

  it('always contains the protected-traits ban', () => {
    for (const spiciness of ['mild', 'medium', 'hard', 'very-hard'] as const) {
      const [system] = buildMessages(noContext, { ...cfg, spiciness });
      expect(system.content).toContain(SPICINESS_INSTRUCTIONS[spiciness]);
      expect(system.content).toMatch(/race.*religion.*sexual orientation.*disability/s);
    }
  });

  it('builds the user message with and without context', () => {
    expect(buildMessages(withContext, cfg)[1]).toEqual({
      role: 'user',
      content: 'Person: Marek\nTheir message: "crypto zrobi x10"',
    });
    expect(buildMessages(noContext, cfg)[1]).toEqual({ role: 'user', content: 'Person: Kaśka' });
  });

  it('uses SYSTEM_PROMPT override with placeholders, leaving unknown ones as-is', () => {
    const [system] = buildMessages(
      noContext,
      { ...cfg, spiciness: 'mild', systemPrompt: 'Pisz po {language}. {spiciness} Kąt: {angle}. {unknown} {constructor}' },
      () => 0,
    );
    expect(system.content).toBe(
      `Pisz po polski. ${SPICINESS_INSTRUCTIONS.mild} Kąt: ${GENERAL_ANGLES[0]}. {unknown} {constructor}`,
    );
  });

  it('default prompt only uses known placeholders', () => {
    const placeholders = [...DEFAULT_SYSTEM_PROMPT.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(placeholders).toEqual(['angle', 'language', 'spiciness']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/prompt.test.ts`
Expected: FAIL — cannot resolve `../src/prompt`.

- [ ] **Step 3: Implement `src/prompt.ts`**

```ts
import type { Config, Spiciness } from './config';
import type { RoastRequest } from './parse';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export const SPICINESS_INSTRUCTIONS: Record<Spiciness, string> = {
  mild: 'Keep it witty and clean: no swearing or vulgarity.',
  medium: 'Light swearing is allowed, but wit comes first.',
  hard: 'Strong profanity is allowed and encouraged.',
  'very-hard': 'No holding back: be maximally brutal and vulgar.',
};

export const MESSAGE_ANGLE = 'mock what they just wrote';

// Body/appearance deliberately excluded.
export const GENERAL_ANGLES = [
  'a "your mum" joke',
  'their intelligence',
  'their life choices',
  'their job and money situation',
  'their laziness',
  'compare them to an animal or an object',
  'absurd hyperbole',
  'an everyday-life situation',
] as const;

export const DEFAULT_SYSTEM_PROMPT = [
  'You are a merciless comedian in a group chat of friends.',
  'Write ONE short (max 2 sentences), creative and funny comeback telling the given person to shut up.',
  'Address them by name.',
  'Write in {language}, using natural, colloquial language as a native speaker would.',
  'If their message is provided, use it as material.',
  'Comedic angle for this one: {angle}.',
  '{spiciness}',
  'Forbidden at every level: attacks on race, ethnicity, religion, sexual orientation, gender identity, disability, and threats of violence.',
  'Output only the roast, no quotes, no preamble.',
].join(' ');

export function pickAngle(hasContext: boolean, rng: () => number): string {
  const pool: readonly string[] = hasContext ? [MESSAGE_ANGLE, ...GENERAL_ANGLES] : GENERAL_ANGLES;
  const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  return pool[index];
}

export function buildMessages(
  req: RoastRequest,
  cfg: Pick<Config, 'language' | 'spiciness' | 'systemPrompt'>,
  rng: () => number = Math.random,
): ChatMessage[] {
  const values: Record<string, string> = {
    language: cfg.language,
    spiciness: SPICINESS_INSTRUCTIONS[cfg.spiciness],
    angle: pickAngle(Boolean(req.context), rng),
  };
  const system = (cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT).replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? values[key] : placeholder,
  );
  const user = req.context
    ? `Person: ${req.targetName}\nTheir message: "${req.context}"`
    : `Person: ${req.targetName}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/prompt.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/prompt.ts test/prompt.test.ts
git commit -m "Build roast prompt with spiciness levels and random angle"
```

---

### Task 4: OpenAI-compatible AI client

**Files:**
- Create: `src/ai.ts`
- Test: `test/ai.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` from `src/prompt.ts`
- Produces:
  ```ts
  interface AiOptions { baseUrl: string; apiKey: string; model: string; reasoningEffort?: string; timeoutMs?: number }
  const DEFAULT_AI_TIMEOUT_MS = 10_000;
  function cleanOutput(text: string): string
  function generateRoast(messages: ChatMessage[], opts: AiOptions): Promise<string> // throws on non-2xx / empty
  ```

- [ ] **Step 1: Write the failing tests**

`test/ai.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanOutput, generateRoast, type AiOptions } from '../src/ai';
import type { ChatMessage } from '../src/prompt';

const messages: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'Person: Marek' },
];
const opts: AiOptions = { baseUrl: 'https://ai.example/v1', apiKey: 'key', model: 'm', reasoningEffort: 'low' };

const completion = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('generateRoast', () => {
  it('sends an OpenAI-compatible chat completion request', async () => {
    const fetchMock = stubFetch(completion('Marek, zamknij się.'));
    await generateRoast(messages, opts);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ai.example/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer key', 'Content-Type': 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'm',
      messages,
      temperature: 1.0,
      max_tokens: 300,
      reasoning_effort: 'low',
    });
  });

  it('omits reasoning_effort when not configured', async () => {
    const fetchMock = stubFetch(completion('ok'));
    await generateRoast(messages, { ...opts, reasoningEffort: undefined });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty('reasoning_effort');
  });

  it('returns the cleaned roast', async () => {
    stubFetch(completion('  „Marek, zamknij się.”  '));
    await expect(generateRoast(messages, opts)).resolves.toBe('Marek, zamknij się.');
  });

  it('throws on non-2xx (Gemini returns errors as an array)', async () => {
    stubFetch(new Response('[{"error":{"code":404,"message":"model gone"}}]', { status: 404 }));
    await expect(generateRoast(messages, opts)).rejects.toThrow(/404.*model gone/);
  });

  it('throws when the model was blocked (content null)', async () => {
    stubFetch(completion(null));
    await expect(generateRoast(messages, opts)).rejects.toThrow(/empty/);
  });

  it('throws when the output is only whitespace or thoughts', async () => {
    stubFetch(completion('  <thought>hmm</thought>  '));
    await expect(generateRoast(messages, opts)).rejects.toThrow(/empty/);
  });
});

describe('cleanOutput', () => {
  it('strips <thought> blocks', () => {
    expect(cleanOutput('<thought>plan\nthings</thought>\nMarek, cicho.')).toBe('Marek, cicho.');
  });

  it('strips quotes wrapping the whole roast', () => {
    expect(cleanOutput('"Marek, cicho."')).toBe('Marek, cicho.');
    expect(cleanOutput('„Marek, cicho.”')).toBe('Marek, cicho.');
  });

  it('keeps quotes that are part of the roast', () => {
    expect(cleanOutput('Twoja „inwestycja” to żart.')).toBe('Twoja „inwestycja” to żart.');
    expect(cleanOutput('Twoja „inwestycja”')).toBe('Twoja „inwestycja”');
  });
});
```

Note on the last case: `Twoja „inwestycja”` ends with a quote but doesn't start with one, so it must be left alone — strip only when the text both starts and ends with a quote.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ai.test.ts`
Expected: FAIL — cannot resolve `../src/ai`.

- [ ] **Step 3: Implement `src/ai.ts`**

```ts
import type { ChatMessage } from './prompt';

export interface AiOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
  timeoutMs?: number;
}

export const DEFAULT_AI_TIMEOUT_MS = 10_000;

const WRAPPED_IN_QUOTES = /^["'„“”«»]([\s\S]*)["'„“”«»]$/;

export function cleanOutput(text: string): string {
  const withoutThoughts = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  const quoted = WRAPPED_IN_QUOTES.exec(withoutThoughts);
  return (quoted ? quoted[1] : withoutThoughts).trim();
}

export async function generateRoast(messages: ChatMessage[], opts: AiOptions): Promise<string> {
  const body: Record<string, unknown> = { model: opts.model, messages, temperature: 1.0, max_tokens: 300 };
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const roast = cleanOutput(data.choices?.[0]?.message?.content ?? '');
  if (!roast) throw new Error(`AI returned an empty roast: ${JSON.stringify(data).slice(0, 300)}`);
  return roast;
}
```

The `'Twoja „inwestycja”'` case passes because the regex requires a quote at the start too.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/ai.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ai.ts test/ai.test.ts
git commit -m "Add OpenAI-compatible roast generation client"
```

---

### Task 5: Telegram client, update handler, Worker entry

**Files:**
- Create: `src/telegram.ts`, `src/handler.ts`, `src/index.ts`
- Test: `test/handler.test.ts`, `test/index.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `Config`, `Env` (Task 1); `TgUpdate` (Task 1); `parseCommand`, `RoastRequest` (Task 2); `buildMessages` (Task 3); `generateRoast` (Task 4)
- Produces:
  ```ts
  // src/telegram.ts
  interface SendMessageOptions { chatId: number; text: string; threadId?: number; replyToMessageId?: number }
  function sendMessage(token: string, opts: SendMessageOptions): Promise<void> // throws on non-2xx
  // src/handler.ts
  function addressRoast(req: RoastRequest, roast: string): string
  function handleUpdate(update: TgUpdate, cfg: Config, rng?: () => number): Promise<void> // never throws
  // src/index.ts
  default export { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
  ```

Addressing rules (`addressRoast`): reply case → roast unchanged. Otherwise: starts with the handle → unchanged; starts with the name → the name is replaced by the handle when there is one (so the target gets pinged); else prefix `"<handle ?? name>, "`.

- [ ] **Step 1: Write the failing handler tests**

`test/handler.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type Env } from '../src/config';
import { addressRoast, handleUpdate } from '../src/handler';
import type { TgMessage, TgUpdate } from '../src/types';

const env: Env = {
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'secret',
  AI_API_KEY: 'key',
  BOT_USERNAME: 'ZamknijBot',
};
const cfg = loadConfig(env);

const marek = { id: 1, is_bot: false, first_name: 'Marek', username: 'marek_x' };
const kaska = { id: 2, is_bot: false, first_name: 'Kaśka' };

function update(message: Partial<TgMessage>): TgUpdate {
  return { update_id: 1, message: { message_id: 10, chat: { id: -100 }, from: kaska, text: '/zamknij', ...message } };
}

const completion = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

let sent: Record<string, unknown>[];
let aiResponse: () => Response;
let telegramResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sent = [];
  aiResponse = () => completion('Marek, zamknij się.');
  telegramResponse = () => new Response('{"ok":true}', { status: 200 });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://api.telegram.org/bottg-token/sendMessage')) {
      sent.push(JSON.parse(String(init?.body)));
      return telegramResponse();
    }
    return aiResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleUpdate', () => {
  it('replies to the target message with the roast', async () => {
    await handleUpdate(update({ reply_to_message: { message_id: 5, chat: { id: -100 }, from: marek, text: 'x10' } }), cfg);
    expect(sent).toEqual([
      {
        chat_id: -100,
        text: 'Marek, zamknij się.',
        reply_parameters: { message_id: 5, allow_sending_without_reply: true },
      },
    ]);
  });

  it('addresses a mentioned user by handle', async () => {
    const text = '/zamknij @marek_x';
    aiResponse = () => completion('Zamknij się, geniuszu.');
    await handleUpdate(update({ text, entities: [{ type: 'mention', offset: 9, length: 8 }] }), cfg);
    expect(sent).toEqual([{ chat_id: -100, text: '@marek_x, Zamknij się, geniuszu.' }]);
  });

  it('sends the fallback text when the AI fails', async () => {
    aiResponse = () => new Response('boom', { status: 500 });
    await handleUpdate(update({}), cfg);
    expect(sent).toEqual([{ chat_id: -100, text: `Kaśka, ${cfg.fallbackText}` }]);
    expect(console.error).toHaveBeenCalled();
  });

  it('sends the fallback text when the AI response was blocked', async () => {
    aiResponse = () => completion(null);
    await handleUpdate(update({}), cfg);
    expect(sent[0].text).toBe(`Kaśka, ${cfg.fallbackText}`);
  });

  it('posts into the forum topic the command came from', async () => {
    await handleUpdate(update({ is_topic_message: true, message_thread_id: 77 }), cfg);
    expect(sent[0]).toMatchObject({ chat_id: -100, message_thread_id: 77 });
  });

  it('ignores chats outside the allowlist', async () => {
    await handleUpdate(update({}), { ...cfg, allowedChatIds: [-999] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores non-command messages and updates without a message', async () => {
    await handleUpdate(update({ text: 'siema' }), cfg);
    await handleUpdate({ update_id: 2 }, cfg);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when Telegram rejects the message', async () => {
    telegramResponse = () => new Response('{"ok":false}', { status: 400 });
    await expect(handleUpdate(update({}), cfg)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('addressRoast', () => {
  const mention = { chatId: 1, targetName: 'Marek', targetHandle: '@marek_x' };

  it('leaves reply roasts unchanged', () => {
    expect(addressRoast({ ...mention, replyToMessageId: 5 }, 'Cicho.')).toBe('Cicho.');
  });

  it('replaces a leading name with the handle', () => {
    expect(addressRoast(mention, 'Marek, cicho.')).toBe('@marek_x, cicho.');
  });

  it('leaves a roast starting with the handle unchanged', () => {
    expect(addressRoast(mention, '@marek_x, cicho.')).toBe('@marek_x, cicho.');
  });

  it('keeps a leading name when there is no handle', () => {
    expect(addressRoast({ chatId: 1, targetName: 'Kaśka' }, 'kaśka, cicho.')).toBe('kaśka, cicho.');
  });

  it('prefixes handle or name otherwise', () => {
    expect(addressRoast(mention, 'Cicho.')).toBe('@marek_x, Cicho.');
    expect(addressRoast({ chatId: 1, targetName: 'Kaśka' }, 'Cicho.')).toBe('Kaśka, Cicho.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/handler.test.ts`
Expected: FAIL — cannot resolve `../src/handler`.

- [ ] **Step 3: Implement `src/telegram.ts` and `src/handler.ts`**

`src/telegram.ts`:
```ts
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
```

`src/handler.ts`:
```ts
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
```

- [ ] **Step 4: Run handler tests**

Run: `npx vitest run test/handler.test.ts`
Expected: all PASS.

- [ ] **Step 5: Write the failing Worker entry tests**

`test/index.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config';
import worker from '../src/index';

const env: Env = {
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'secret',
  AI_API_KEY: 'key',
  BOT_USERNAME: 'ZamknijBot',
};

function makeCtx() {
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException() {} };
  return { tasks, ctx: ctx as unknown as ExecutionContext };
}

function post(body: string, secret: string | null = 'secret') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request('https://bot.example/', { method: 'POST', headers, body });
}

const commandUpdate = JSON.stringify({
  update_id: 1,
  message: { message_id: 10, chat: { id: -100 }, from: { id: 2, is_bot: false, first_name: 'Kaśka' }, text: '/zamknij' },
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('api.telegram.org')
      ? new Response('{"ok":true}')
      : new Response(JSON.stringify({ choices: [{ message: { content: 'Kaśka, cicho.' } }] })),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('worker.fetch', () => {
  it('rejects non-POST with 405', async () => {
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request('https://bot.example/'), env, ctx);
    expect(res.status).toBe(405);
  });

  it.each([['wrong'], [null]])('rejects secret %j with 401 and does no work', async (secret) => {
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post(commandUpdate, secret), env, ctx);
    expect(res.status).toBe(401);
    expect(tasks).toHaveLength(0);
  });

  it('acknowledges invalid JSON with 200 and does no work', async () => {
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post('not json'), env, ctx);
    expect(res.status).toBe(200);
    expect(tasks).toHaveLength(0);
  });

  it('returns 200 immediately and roasts in waitUntil', async () => {
    const { ctx, tasks } = makeCtx();
    const res = await worker.fetch(post(commandUpdate), env, ctx);
    expect(res.status).toBe(200);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    const telegramCall = fetchMock.mock.calls.find(([url]) => String(url).includes('api.telegram.org'));
    expect(JSON.parse(String(telegramCall?.[1]?.body))).toMatchObject({ chat_id: -100, text: 'Kaśka, cicho.' });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 7: Implement `src/index.ts`**

```ts
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
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/telegram.ts src/handler.ts src/index.ts test/handler.test.ts test/index.test.ts
git commit -m "Wire Telegram webhook handler and Worker entry"
```

---

### Task 6: Dev scripts, README, live checks

**Files:**
- Create: `scripts/set-webhook.mjs`, `scripts/try-roast.ts`, `README.md`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `parseCommand`-shaped `RoastRequest` (Task 2), `buildMessages` (Task 3), `generateRoast` (Task 4)

- [ ] **Step 1: Write `scripts/set-webhook.mjs`**

```js
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
```

- [ ] **Step 2: Write `scripts/try-roast.ts`** (prompt tuning without Telegram)

```ts
// Prints a few roasts using the real prompt and AI provider.
// Usage: AI_API_KEY=... npm run try-roast -- "Marek" "optional message they wrote"
// Optional env overrides: LANGUAGE, SPICINESS, AI_MODEL, AI_BASE_URL, AI_REASONING_EFFORT, SYSTEM_PROMPT
import { generateRoast } from '../src/ai';
import { loadConfig } from '../src/config';
import { buildMessages } from '../src/prompt';

const [name = 'Marek', context] = process.argv.slice(2);
const cfg = loadConfig({ ...process.env, TELEGRAM_BOT_TOKEN: '-', TELEGRAM_WEBHOOK_SECRET: '-', BOT_USERNAME: '-' });

for (let i = 0; i < 5; i++) {
  const messages = buildMessages({ chatId: 0, targetName: name, context }, cfg);
  const angle = /Comedic angle for this one: (.*?)\./.exec(messages[0].content)?.[1] ?? 'custom prompt';
  try {
    const roast = await generateRoast(messages, {
      baseUrl: cfg.aiBaseUrl,
      apiKey: cfg.aiApiKey,
      model: cfg.aiModel,
      reasoningEffort: cfg.aiReasoningEffort,
    });
    console.log(`[${angle}] ${roast}\n`);
  } catch (err) {
    console.log(`[${angle}] ERROR: ${(err as Error).message}\n`);
  }
}
```

- [ ] **Step 3: Live Polish quality check**

Run (fish shell; key from the scratchpad file or your own):
```bash
AI_API_KEY=(cat <path-to-gemini.key>) npm run try-roast -- "Marek" "Mówię wam, crypto w tym roku zrobi x10, wchodzę za całą wypłatę"
AI_API_KEY=(cat <path-to-gemini.key>) npm run try-roast -- "Kaśka"
```
Expected: 5 roasts each, in Polish, natural, different angles, no errors. Compare against the spike samples in the spec; if clearly worse, report back before continuing (do not silently tweak the prompt).

- [ ] **Step 4: Write `README.md`**

````markdown
# zamknij-bot

Telegram bot: `/zamknij` → AI-generated roast telling someone to shut up.
Cloudflare Worker + any OpenAI-compatible model (default: Gemini 3.5 Flash-Lite, free tier).

## Usage in a group

- Reply to someone's message with `/zamknij` → roasts the author, using their message as material.
- `/zamknij @username` → roasts that user.
- `/zamknij` alone (or targeting the bot) → roasts you.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), note the token and username.
   If `/zamknij` without `@BotName` is ignored in your group, run `/setprivacy` → Disable in BotFather
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
   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- https://zamknij-bot.<you>.workers.dev
   ```

## Configuration (`wrangler.jsonc` → `vars`)

| Var | Default | Notes |
|---|---|---|
| `BOT_USERNAME` | — | Required, without `@` |
| `LANGUAGE` | `polski` | Output language |
| `SPICINESS` | `very-hard` | `mild` \| `medium` \| `hard` \| `very-hard` |
| `COMMAND` | `zamknij` | Command name without `/` |
| `AI_BASE_URL` | Gemini OpenAI endpoint | Any OpenAI-compatible `/chat/completions` base |
| `AI_MODEL` | `gemini-3.5-flash-lite` | |
| `AI_REASONING_EFFORT` | `low` | `""` = don't send it (some models reject it) |
| `ALLOWED_CHAT_IDS` | `""` (all) | Comma-separated chat ids |
| `SYSTEM_PROMPT` | `""` (built-in) | Full override; placeholders `{language}` `{spiciness}` `{angle}` |
| `FALLBACK_TEXT` | `Zamknij się. (AI odmówiło współpracy)` | Sent when the AI fails |

Switching provider = changing `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, e.g.
Groq `https://api.groq.com/openai/v1`, DeepSeek `https://api.deepseek.com`,
OpenRouter `https://openrouter.ai/api/v1`.

## Development

```bash
npm test             # unit tests
npm run typecheck
AI_API_KEY=... npm run try-roast -- "Marek" "co napisał"   # try the prompt without Telegram
```

Note: on Gemini's free tier, Google may use prompts (including quoted chat messages) to improve its models.
````

- [ ] **Step 5: Final verification**

Run: `npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir /tmp/zamknij-dry`
Expected: tests PASS, no type errors, wrangler bundles without errors (dry run needs no login).

- [ ] **Step 6: Commit**

```bash
git add scripts/set-webhook.mjs scripts/try-roast.ts README.md
git commit -m "Add webhook/prompt scripts and README"
```

- [ ] **Step 7: Deploy (needs the user)**

Deployment requires `npx wrangler login`, a BotFather token and setting secrets — hand these steps (README → Setup 1–4) to the user rather than doing them unattended. After deploy, smoke test in a real group: reply-roast, @mention-roast, bare `/zamknij`.
