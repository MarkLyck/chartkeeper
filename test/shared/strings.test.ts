import { afterEach, describe, expect, it, vi } from 'vitest';
import { mainString } from '../../src/shared/mainStrings';
import { fill } from '../../src/shared/template';

afterEach(() => vi.restoreAllMocks());

describe('message templates', () => {
  it('fills every placeholder, numbers included', () => {
    expect(fill('{n} of {total} layouts in {name}', { n: 2, total: 10, name: 'Plus' })).toBe('2 of 10 layouts in Plus');
  });

  it('leaves a missing value out instead of showing "{name}" or "undefined", and logs which one', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(fill('Plan: {plan}.', {})).toBe('Plan: .');
    expect(err.mock.calls).toEqual([['i18n: missing param {plan} in "Plan: {plan}."']]);
  });
});

describe('notifications from the app process', () => {
  it('puts the reason into the backup-failed notification', () => {
    expect(mainString('backupFailedBody', { detail: 'No internet.' })).toBe('Open ChartKeeper to see why. No internet.');
  });

  it('counts the layouts of a finished backup', () => {
    expect(mainString('backupDoneBody', { n: 3 })).toBe('3 layouts saved.');
  });

  // Bug: a free account has one layout, and its notification reads "1 layouts saved.".
  it('says "1 layout saved." after backing up a single layout, and "3 layouts saved." otherwise', () => {
    expect(mainString('backupDoneBody', { n: 1 })).toBe('1 layout saved.');
    expect(mainString('backupDoneBody', { n: 3 })).toBe('3 layouts saved.');
  });
});
