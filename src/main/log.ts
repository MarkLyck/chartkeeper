import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

export function log(line: string): void {
  try {
    const f = path.join(app.getPath('userData'), 'logs', 'chartkeeper.log');
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    if ((statSync(f, { throwIfNoEntry: false })?.size ?? 0) > 2_000_000) renameSync(f, `${f}.old`);
    appendFileSync(f, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    /* logging must never break the app */
  }
}
