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
