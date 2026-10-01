import type { Config, Spiciness } from './config';
import type { RoastRequest } from './parse';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

// The built-in prompt is Polish on purpose: with an English prompt and no Polish
// context the model drifted into English (live check, 2026-10-01). For another
// output language set LANGUAGE and ideally a SYSTEM_PROMPT written in that language.

export const SPICINESS_INSTRUCTIONS: Record<Spiciness, string> = {
  mild: 'Dowcipnie i kulturalnie: bez przekleństw i wulgaryzmów.',
  medium: 'Lekkie przekleństwa dozwolone, ale najważniejszy jest dowcip.',
  hard: 'Mocne przekleństwa dozwolone i mile widziane.',
  'very-hard': 'Bez hamulców: maksymalnie brutalnie i wulgarnie.',
};

export const MESSAGE_ANGLE = 'wyśmiej to, co właśnie napisała ta osoba';

// Body/appearance deliberately excluded.
export const GENERAL_ANGLES = [
  'żart o jej starej (klasyczne „twoja stara”)',
  'jej inteligencja',
  'jej życiowe wybory',
  'jej praca i kasa',
  'jej lenistwo',
  'porównanie do zwierzęcia albo przedmiotu',
  'absurdalna przesada',
  'sytuacja z codziennego życia',
  'twarz danej osoby',
  'wygląd',
] as const;

export const DEFAULT_SYSTEM_PROMPT = [
  'Piszesz wyłącznie w języku: {language}.',
  'Jesteś bezlitosnym komikiem na grupowym czacie znajomych.',
  'Wymyśl JEDNĄ krótką (max 1 zdanie), kreatywną i śmieszną ripostę, która każe wskazanej osobie się zamknąć XD.',
  'Zwracaj się do niej po imieniu.',
  'Pisz naturalnym, potocznym językiem, jak rodzimy użytkownik.',
  'Jeśli podano jej wiadomość, wykorzystaj ją jako materiał.',
  'Motyw tej riposty: {angle}.',
  '{spiciness}',
  'Zawsze zakazane: nic, bez hamulców.',
  'Odpowiedz wyłącznie samą ripostą, bez cudzysłowów i wstępów.',
  'Riposta MUSI być w całości w języku: {language}.',
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
  const user = [
    `Osoba: ${req.targetName}`,
    ...(req.context ? [`Jej wiadomość: "${req.context}"`] : []),
    `Odpowiedz wyłącznie w języku: ${cfg.language}.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
