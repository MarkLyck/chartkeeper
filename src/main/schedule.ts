import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Whether the daily backup is due: it runs once per calendar day, after the
 * chosen hour, and catches up if the computer was off or asleep at that time.
 */
export function isBackupDue(now: Date, dailyHour: number, lastBackupAt: Date | null): boolean {
  if (now.getHours() < dailyHour) return false;
  if (!lastBackupAt) return true;
  const todayAtHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dailyHour);
  return lastBackupAt < todayAtHour;
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
