import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings, Store } from '../../src/main/store';

describe('settings file', () => {
  it('keeps the newest state when many changes are saved at once', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-store-'));
    const file = path.join(dir, 'settings.json');
    const store = await Store.open(file, defaultSettings(dir, 'da-DK'));
    await Promise.all(Array.from({ length: 100 }, (_, h) => store.update({ settings: { dailyHour: h % 24 } })));
    const reopened = await Store.open(file, defaultSettings(dir, 'en-US'));
    expect(reopened.settings.dailyHour).toBe(99 % 24);
    expect(reopened.settings.lang).toBe('da');
  });
});
