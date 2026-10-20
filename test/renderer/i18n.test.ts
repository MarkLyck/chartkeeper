import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupStep } from '../../src/core/backupProgress';
import type { RestoreStep } from '../../src/core/restore';
import {
  BACKUP_STEP_KEYS, backupStepText, ERROR_KEYS, explainError, formatHour, formatRelative, RESTORE_STEP_KEYS, restoreStepText, TEXT, tn, type Key,
} from '../../src/renderer/i18n';
import type { AppError } from '../../src/shared/api';

const keys = Object.keys(TEXT) as Key[];

// Written out so a new kind or step in core fails `tsc` here until it has words.
const ERROR_KINDS = ['not-signed-in', 'rate-limited', 'format-changed', 'limit-reached', 'too-large', 'not-found', 'network', 'server', 'cancelled', 'unexpected', 'busy', 'browser', 'safari-access'] as const satisfies readonly AppError['kind'][];
const BACKUP_STEPS = ['list', 'layout', 'userDrawings', 'studyTemplates', 'drawingTemplates', 'themes', 'scripts', 'prices', 'finish'] as const satisfies readonly BackupStep[];
const RESTORE_STEPS = ['check', 'create', 'verify'] as const satisfies readonly RestoreStep[];
const exhaustive: [Exclude<AppError['kind'], (typeof ERROR_KINDS)[number]>, Exclude<BackupStep, (typeof BACKUP_STEPS)[number]>, Exclude<RestoreStep, (typeof RESTORE_STEPS)[number]>] extends [never, never, never] ? true : false = true;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the string table', () => {
  it('has non-empty text for every key', () => {
    expect(exhaustive).toBe(true);
    expect(keys.filter((k) => !TEXT[k].trim())).toEqual([]);
  });

  it('writes every placeholder as {name}, so the typed params of t() match what gets filled', () => {
    const malformed = keys.filter((k) => TEXT[k].replace(/\{\w+\}/g, '').match(/[{}]/));
    expect(malformed).toEqual([]);
  });

  it('has both plural forms for every counted word', () => {
    const ones = keys.filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4));
    const others = keys.filter((k) => k.endsWith('_other')).map((k) => k.slice(0, -6));
    expect(others.sort()).toEqual(ones.sort());
  });
});

describe('every failure and step has words', () => {
  it('explains every error kind with all params filled', () => {
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

  it('words limit-reached with the plan and limit from params', () => {
    const { body } = explainError({ kind: 'limit-reached', message: '', params: { limit: 10, plan: 'Plus' } });
    expect(body).toContain('10');
    expect(body).toContain('Plus');
    expect(explainError({ kind: 'limit-reached', message: '', params: {} }).body).not.toMatch(/[{}]|undefined/);
  });

  it('has a sentence for every backup step', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const step of BACKUP_STEPS) {
      expect(BACKUP_STEP_KEYS[step]).toBeDefined();
      const text = backupStepText(step, 'Microsoft');
      expect(text.trim(), step).not.toBe('');
      if (step === 'layout' || step === 'prices') expect(text, step).toContain('Microsoft');
    }
    expect(err).not.toHaveBeenCalled();
  });

  it('has a sentence for every restore step', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const step of RESTORE_STEPS) {
      expect(RESTORE_STEP_KEYS[step]).toBeDefined();
      expect(restoreStepText(step).trim(), step).not.toBe('');
    }
    expect(err).not.toHaveBeenCalled();
  });
});

describe('relative dates', () => {
  const now = new Date(2026, 9, 17, 15, 0);
  it('says today and yesterday in plain words', () => {
    expect(formatRelative(new Date(2026, 9, 17, 9, 12), now)).toBe('today at 09:12');
    expect(formatRelative(new Date(2026, 9, 16, 18, 0), now)).toBe('yesterday at 18:00');
    expect(formatRelative(new Date(2026, 9, 14, 18, 0), now)).toBe('3 days ago');
    expect(formatRelative(new Date(2026, 9, 1, 9, 12), now)).toBe('1 October 2026');
  });

  it('writes the daily backup hour on the 24-hour clock', () => {
    expect(formatHour(7)).toBe('07:00');
    expect(formatHour(18)).toBe('18:00');
  });
});

describe('counted words', () => {
  it('uses the singular only for exactly one, and groups thousands', () => {
    expect(tn('count.layouts', 1)).toBe('1 layout');
    expect(tn('count.layouts', 0)).toBe('0 layouts');
    expect(tn('count.drawings', 1234)).toBe('1,234 drawings');
  });
});
