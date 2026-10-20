import type { UpdateInfo } from 'electron-updater';
import type { UpdateHow, UpdateRelease, UpdateState } from '../shared/api';
import type { AppStatus } from './appState';

export const RELEASES_PAGE = 'https://github.com/MarkLyck/chartkeeper/releases/latest';

/** Where new versions come from: electron-updater in the app (src/main/updateSource.ts), a fake in tests. */
export interface UpdateSource {
  readonly how: UpdateHow;
  /** The newer release, or null when this version is the newest. */
  check(): Promise<{ version: string; notes: string } | null>;
  /** Downloads the new version and checks its sha512, reporting 0-100 as it goes. */
  download(onPercent: (percent: number) => void): Promise<void>;
  /** 'restart': quits, installs and starts the new version. 'installer': opens the downloaded installer. */
  install(): Promise<void>;
}

export type UpdateEvent =
  | { k: 'found'; release: UpdateRelease }
  | { k: 'postpone' }
  | { k: 'show' }
  | { k: 'start' }
  | { k: 'progress'; percent: number }
  | { k: 'installed' }
  | { k: 'failed'; message: string };

/** The one place update states change. An event that doesn't apply returns the same state object. */
export function nextUpdate(s: UpdateState, e: UpdateEvent): UpdateState {
  if (s.k === 'none') return e.k === 'found' ? { k: 'available', ...e.release } : s;
  const release: UpdateRelease = { version: s.version, notes: s.notes, how: s.how };
  switch (e.k) {
    case 'postpone':
      return s.k === 'available' || s.k === 'installer-open' || s.k === 'failed' ? { k: 'later', ...release } : s;
    case 'show':
      return s.k === 'later' ? { k: 'available', ...release } : s;
    case 'start':
      return s.k === 'available' ? { k: 'downloading', percent: 0, ...release } : s;
    case 'progress': {
      const percent = Math.round(Math.min(100, Math.max(0, e.percent)));
      return s.k === 'downloading' && percent !== s.percent ? { ...s, percent } : s;
    }
    case 'installed':
      // A restart quits the app, so its download stays on screen until then.
      return s.k === 'downloading' && s.how === 'installer' ? { k: 'installer-open', ...release } : s;
    case 'failed':
      return s.k === 'downloading' ? { k: 'failed', message: e.message, ...release } : s;
    case 'found':
      return s;
  }
}

/** Checks for a new version once per launch and runs the update the user asks for. */
export class Updater {
  constructor(
    private readonly source: UpdateSource,
    private readonly status: AppStatus,
    private readonly log: (line: string) => void,
  ) {}

  async check(): Promise<void> {
    try {
      const found = await this.source.check();
      if (found) this.apply({ k: 'found', release: { ...found, how: this.source.how } });
    } catch (e) {
      this.log(`update check failed: ${(e as Error)?.stack ?? String(e)}`);
    }
  }

  postpone(): void {
    this.apply({ k: 'postpone' });
  }

  show(): void {
    this.apply({ k: 'show' });
  }

  /** Runs as a task, so it waits for no backup or restore and none can start until the download is over. */
  async start(): Promise<void> {
    if (this.status.update.k !== 'available') return;
    const r = await this.status.exclusive('update', async () => {
      this.apply({ k: 'start' });
      await this.source.download((percent) => this.apply({ k: 'progress', percent }));
      await this.source.install();
      this.apply({ k: 'installed' });
    });
    if (r.ok) return;
    if (r.error.kind === 'busy') this.log(`update not started: ${r.error.message}`);
    else this.apply({ k: 'failed', message: r.error.message });
  }

  private apply(e: UpdateEvent): void {
    this.status.setUpdate(nextUpdate(this.status.update, e));
  }
}

const NOTES_MAX = 800;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(entity: string, code: string): string {
  if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
  const hex = code[1] === 'x' || code[1] === 'X';
  const n = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
  return n <= 0x10ffff ? String.fromCodePoint(n) : entity;
}

/**
 * Release notes as plain lines. GitHub sends them as HTML, a release file may hold markdown;
 * the popup shows text only, one line per paragraph or list item.
 */
export function plainNotes(raw: UpdateInfo['releaseNotes']): string {
  const text = typeof raw === 'string' ? raw : (raw ?? []).map((r) => r.note ?? '').join('\n');
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|ul|ol|pre|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, decodeEntity)
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[*-]\s+/, '• ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2'),
    )
    .filter(Boolean);
  const plain = lines.join('\n');
  return plain.length > NOTES_MAX ? `${plain.slice(0, NOTES_MAX).trimEnd()}…` : plain;
}
