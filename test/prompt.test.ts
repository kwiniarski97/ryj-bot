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
