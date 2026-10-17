import { ipcMain, type BrowserWindow } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Events, type Invoke } from '../shared/api';

/** Registers the handler for one method of the window's api, checked against its signature in src/shared/api.ts. */
export function handle<K extends keyof Invoke>(method: K, fn: (...args: Parameters<Invoke[K]>) => ReturnType<Invoke[K]>): void {
  ipcMain.handle(INVOKE_CHANNELS[method], (_e, ...args: unknown[]) => fn(...(args as Parameters<Invoke[K]>)));
}

export function emit<K extends keyof Events>(win: BrowserWindow | null, event: K, payload: Events[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNELS[event], payload);
}
