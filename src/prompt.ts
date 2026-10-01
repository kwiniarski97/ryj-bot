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
