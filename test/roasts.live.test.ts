// Live check: one roast per angle using the real prompt and AI provider, written to roasts.txt (gitignored).
// Skipped unless AI_API_KEY is set. Usage: AI_API_KEY=... npm run roasts
// Optional env overrides: ROAST_NAME, ROAST_CONTEXT, LANGUAGE, SPICINESS, AI_MODEL, AI_BASE_URL, AI_REASONING_EFFORT, SYSTEM_PROMPT
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateRoast } from '../src/ai';
import { loadConfig } from '../src/config';
import { buildMessages, GENERAL_ANGLES, MESSAGE_ANGLE } from '../src/prompt';

const OUTPUT_FILE = 'roasts.txt';
const ANGLES = [MESSAGE_ANGLE, ...GENERAL_ANGLES];

describe.skipIf(!process.env.AI_API_KEY)('live roasts', () => {
  it(`writes one roast per angle to ${OUTPUT_FILE}`, { timeout: 10 * 60_000 }, async () => {
    const cfg = loadConfig({ ...process.env, TELEGRAM_BOT_TOKEN: '-', TELEGRAM_WEBHOOK_SECRET: '-', BOT_USERNAME: '-' });
    const req = {
      chatId: 0,
      targetName: process.env.ROAST_NAME ?? 'Marek',
      context: process.env.ROAST_CONTEXT ?? 'crypto zrobi x10',
    };
    const lines = [
      `# ${new Date().toISOString()} | ${cfg.aiModel} | ${cfg.spiciness} | ${req.targetName}: "${req.context}"`,
      '',
    ];
    let failures = 0;

    // Sequential on purpose: free-tier rate limits. The rng picks angle i from [MESSAGE_ANGLE, ...GENERAL_ANGLES].
    for (const [i, angle] of ANGLES.entries()) {
      const messages = buildMessages(req, cfg, () => (i + 0.5) / ANGLES.length);
      try {
        const roast = await generateRoast(messages, {
          baseUrl: cfg.aiBaseUrl,
          apiKey: cfg.aiApiKey,
          model: cfg.aiModel,
          reasoningEffort: cfg.aiReasoningEffort,
          timeoutMs: 30_000,
        });
        lines.push(`[${angle}]`, roast, '');
      } catch (err) {
        failures++;
        lines.push(`[${angle}]`, `ERROR: ${(err as Error).message}`, '');
      }
      writeFileSync(OUTPUT_FILE, lines.join('\n'));
    }

    expect(failures, `${failures}/${ANGLES.length} roasts failed, see ${OUTPUT_FILE}`).toBe(0);
  });
});
