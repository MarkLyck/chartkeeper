import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupStep } from '../../src/core/backup';
import type { RestoreStep } from '../../src/core/restore';
import {
  BACKUP_STEP_KEYS, backupStepText, DICTIONARIES, ERROR_KEYS, explainError, formatRelative, RESTORE_STEP_KEYS, restoreStepText, setLang, type Key,
} from '../../src/renderer/i18n';
import type { AppError, Lang } from '../../src/shared/api';

const LANGS: Lang[] = ['da', 'en'];
const keys = Object.keys(DICTIONARIES.en) as Key[];
const placeholders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));

// Written out so a new kind or step in core fails `tsc` here until it has words.
const ERROR_KINDS = ['not-signed-in', 'rate-limited', 'format-changed', 'limit-reached', 'too-large', 'not-found', 'network', 'server', 'cancelled', 'unexpected', 'busy', 'browser'] as const satisfies readonly AppError['kind'][];
const BACKUP_STEPS = ['list', 'layout', 'userDrawings', 'studyTemplates', 'drawingTemplates', 'scripts', 'prices', 'finish'] as const satisfies readonly BackupStep[];
const RESTORE_STEPS = ['check', 'create', 'safetyCopy', 'replace', 'clearDrawings', 'verify'] as const satisfies readonly RestoreStep[];
const exhaustive: [Exclude<AppError['kind'], (typeof ERROR_KINDS)[number]>, Exclude<BackupStep, (typeof BACKUP_STEPS)[number]>, Exclude<RestoreStep, (typeof RESTORE_STEPS)[number]>] extends [never, never, never] ? true : false = true;

afterEach(() => {
  vi.restoreAllMocks();
  setLang('da');
});

describe('dictionaries', () => {
  it('lists the same keys in both languages', () => {
    expect(exhaustive).toBe(true);
    expect(Object.keys(DICTIONARIES.da).sort()).toEqual([...keys].sort());
  });

  it.each(LANGS)('has non-empty text for every key in %s', (lang) => {
    const empty = keys.filter((k) => !DICTIONARIES[lang][k].trim());
    expect(empty).toEqual([]);
  });

  it('uses the same {params} in Danish as in English, since the English string decides what callers must pass', () => {
    const mismatched = keys.filter((k) => [...placeholders(DICTIONARIES.da[k])].sort().join() !== [...placeholders(DICTIONARIES.en[k])].sort().join());
    expect(mismatched).toEqual([]);
  });

  it('has both plural forms for every counted word', () => {
    const ones = keys.filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4));
    const others = keys.filter((k) => k.endsWith('_other')).map((k) => k.slice(0, -6));
    expect(others.sort()).toEqual(ones.sort());
  });
});

describe('every failure and step has words', () => {
  it.each(LANGS)('explains every error kind in %s with all params filled', (lang) => {
    setLang(lang);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const kind of ERROR_KINDS) {
      expect(ERROR_KEYS[kind]).toBeDefined();
      const { title, body } = explainError({ kind, message: 'technical', params: { limit: 5, plan: 'Essential' } });
      expect(title.trim(), kind).not.toBe('');
      expect(body.trim(), kind).not.toBe('');
      expect(body, kind).not.toMatch(/[{}]/);
    }
    expect(err).not.toHaveBeenCalled();
  });

  it.each(LANGS)('words limit-reached with the plan and limit from params in %s', (lang) => {
    setLang(lang);
    const { body } = explainError({ kind: 'limit-reached', message: '', params: { limit: 10, plan: 'Plus' } });
    expect(body).toContain('10');
    expect(body).toContain('Plus');
    expect(explainError({ kind: 'limit-reached', message: '', params: {} }).body).not.toMatch(/[{}]|undefined/);
  });

  it.each(LANGS)('has a sentence for every backup step in %s', (lang) => {
    setLang(lang);
    for (const step of BACKUP_STEPS) {
      expect(BACKUP_STEP_KEYS[step]).toBeDefined();
      const text = backupStepText(step, 'Novo Nordisk');
      expect(text.trim(), step).not.toBe('');
      if (step === 'layout' || step === 'prices') expect(text, step).toContain('Novo Nordisk');
    }
  });

  it.each(LANGS)('has a sentence for every restore step in %s', (lang) => {
    setLang(lang);
    for (const step of RESTORE_STEPS) {
      expect(RESTORE_STEP_KEYS[step]).toBeDefined();
      expect(restoreStepText(step).trim(), step).not.toBe('');
    }
  });
});

describe('relative dates', () => {
  const now = new Date(2026, 9, 17, 15, 0);
  it('says today and yesterday in plain words', () => {
    setLang('da');
    expect(formatRelative(new Date(2026, 9, 17, 9, 12), now)).toBe('i dag kl. 09.12');
    expect(formatRelative(new Date(2026, 9, 16, 18, 0), now)).toBe('i går kl. 18.00');
    expect(formatRelative(new Date(2026, 9, 14, 18, 0), now)).toBe('for 3 dage siden');
    setLang('en');
    expect(formatRelative(new Date(2026, 9, 17, 9, 12), now)).toBe('today at 09:12');
    expect(formatRelative(new Date(2026, 9, 1, 9, 12), now)).toBe('1 October 2026');
  });
});
