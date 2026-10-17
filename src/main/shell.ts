import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron';
import path from 'node:path';
import type { ProgressEvent } from '../shared/api';
import { mainStrings } from '../shared/mainStrings';
import type { AppStatus } from './appState';
import { emit } from './ipc';

const iconPath = () => path.join(__dirname, 'icon.png');

/** The window, the tray icon and the notifications. */
export class Shell {
  private win: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private quitting = false;

  constructor(
    private readonly status: AppStatus,
    private readonly startHidden: boolean,
    private readonly backUpNow: () => void,
  ) {}

  get window(): BrowserWindow | null {
    return this.win;
  }

  get visible(): boolean {
    return !!this.win?.isVisible();
  }

  start(): void {
    this.createWindow();
    this.tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 }));
    this.tray.on('click', () => this.show());
    this.updateTray();
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) this.createWindow();
    this.win!.show();
    this.win!.focus();
  }

  /** From here on, closing the window really closes it. */
  prepareToQuit(): void {
    this.quitting = true;
  }

  async pushState(): Promise<void> {
    emit(this.win, 'state', await this.status.read());
    this.updateTray();
  }

  progress(e: ProgressEvent): void {
    emit(this.win, 'progress', e);
  }

  updateTray(): void {
    if (!this.tray) return;
    const text = this.text();
    this.tray.setToolTip(this.status.busy === 'backup' ? text('trayBackingUp') : 'ChartKeeper');
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: text('trayOpen'), click: () => this.show() },
        { label: text('trayBackUpNow'), enabled: !this.status.busy, click: this.backUpNow },
        { type: 'separator' },
        {
          label: text('trayQuit'),
          click: () => {
            this.prepareToQuit();
            app.quit();
          },
        },
      ]),
    );
  }

  notifyBackup(r: { ok: true; layouts: number } | { ok: false; message: string }): void {
    const text = this.text();
    if (r.ok) this.notify(text('backupDoneTitle'), text('backupDoneBody', { n: r.layouts }));
    else this.notify(text('backupFailedTitle'), text('backupFailedBody', { detail: r.message.slice(0, 120) }));
  }

  notifySignIn(): void {
    const text = this.text();
    this.notify(text('signInNeededTitle'), text('signInNeededBody'));
  }

  private text() {
    return mainStrings(this.status.store.settings.lang);
  }

  private notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => this.show());
    n.show();
  }

  private createWindow(): void {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 1000,
      minHeight: 700,
      show: false,
      title: 'ChartKeeper',
      icon: iconPath(),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.win = win;
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.once('ready-to-show', () => {
      if (!this.startHidden) win.show();
    });
    win.on('close', (e) => {
      if (!this.quitting && this.status.store.settings.dailyBackup) {
        e.preventDefault();
        win.hide();
      }
    });
  }
}
