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
  command: 'ryj',
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
