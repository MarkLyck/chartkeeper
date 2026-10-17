import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** After a failed attempt, wait this long before trying again, so a lasting problem doesn't hammer TradingView. */
export const RETRY_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Whether the daily backup is due: no successful backup since the most recent
 * time the clock passed the chosen hour. So it runs once a day, and catches up
 * as soon as the computer is on again after missing that hour.
 */
export function isBackupDue(now: Date, dailyHour: number, lastSuccess: Date | null, lastAttempt: Date | null): boolean {
  if (lastAttempt && now.getTime() - lastAttempt.getTime() < RETRY_AFTER_MS && (!lastSuccess || lastAttempt > lastSuccess)) return false;
  if (!lastSuccess) return true;
  const mostRecent = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dailyHour);
  if (mostRecent > now) mostRecent.setDate(mostRecent.getDate() - 1);
  return lastSuccess < mostRecent;
}

/** Linux has no login-item API in Electron; desktops follow the XDG autostart folder. */
export async function setLinuxAutostart(enabled: boolean, exec: string, home = os.homedir()): Promise<void> {
  const file = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'autostart', 'chartkeeper.desktop');
  if (!enabled) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const quoted = `"${exec.replace(/(["\\`$])/g, '\\$1')}"`;
  await fs.writeFile(file, ['[Desktop Entry]', 'Type=Application', 'Name=ChartKeeper', `Exec=${quoted} --hidden`, 'X-GNOME-Autostart-enabled=true', 'NoDisplay=false', ''].join('\n'));
}
