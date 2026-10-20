import { describe, expect, it } from 'vitest';
import { secondsLeft } from '../../src/core/backupProgress';
import { formatTimeLeft } from '../../src/renderer/i18n';

describe('time left in a backup', () => {
  it('is unknown until the layout list is in', () => {
    expect(secondsLeft({ step: 'list', done: 0, total: 0 }, 0)).toBeNull();
  });

  it('assumes about two seconds a request at first', () => {
    expect(secondsLeft({ step: 'drawingTemplates', done: 5, total: 95 }, 3_000)).toBe(180);
  });

  it('goes by the measured pace once there is enough of it', () => {
    expect(secondsLeft({ step: 'drawingTemplates', done: 20, total: 80 }, 60_000)).toBe(180);
  });

  it('reads as whole minutes, and as under a minute at the end', () => {
    expect([formatTimeLeft(180), formatTimeLeft(70), formatTimeLeft(59), formatTimeLeft(0)]).toEqual(['About 3 minutes left', 'About 1 minute left', 'Less than a minute left', 'Less than a minute left']);
  });
});
