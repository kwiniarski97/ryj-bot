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
  const angle = /Motyw tej riposty: (.*?)\./.exec(messages[0].content)?.[1] ?? 'custom prompt';
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
