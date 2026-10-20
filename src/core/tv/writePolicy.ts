import { urls } from './endpoints';
import type { HttpRequest } from './http';

/** Every field of a layout save that ChartKeeper sends (see `saveForm`). */
export const LAYOUT_FORM_FIELDS = ['resolution', 'symbol_type', 'exchange', 'listed_exchange', 'symbol', 'short_name', 'legs', 'name', 'description', 'is_realtime', 'content', 'study_meta_info_map'] as const;
export type LayoutForm = Record<(typeof LAYOUT_FORM_FIELDS)[number], string>;

type BodyKind = 'form' | 'json';

export interface AllowedWrite {
  what: string;
  url: string;
  body: BodyKind;
  fields: readonly string[];
}

/**
 * ChartKeeper must never change or delete anything that already exists on
 * TradingView. These are the only writes it may send, and each one creates
 * something new. A layout save that names a layout (`image_url` or `id`)
 * overwrites it, so its fields are a closed list. Templates and themes are
 * saved by name, so TvClient checks that the name is free right before each
 * add.
 */
export const ALLOWED_WRITES: readonly Readonly<AllowedWrite>[] = [
  { what: 'create a layout', url: urls.saveLayout, body: 'form', fields: LAYOUT_FORM_FIELDS },
  { what: 'add an indicator template', url: urls.studyTemplates, body: 'json', fields: ['name', 'content', 'meta_info'] },
  { what: 'add a drawing template', url: urls.saveDrawingTemplate, body: 'form', fields: ['name', 'tool', 'content'] },
  { what: 'add a theme', url: urls.saveTheme, body: 'form', fields: ['name', 'content'] },
];

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const isRead = (method: string): boolean => READS.has(method);

function refusal(method: string, url: string, fieldsOf: (kind: BodyKind) => string[] | null): string | null {
  if (isRead(method)) return null;
  if (method !== 'POST') return `${method} requests change or delete things, and ChartKeeper only reads and creates.`;
  const write = ALLOWED_WRITES.find((w) => w.url === url);
  if (!write) return `${url} is not one of the addresses ChartKeeper may send to.`;
  const fields = fieldsOf(write.body);
  if (fields === null) return `the request to ${write.what} could not be read as ${write.body === 'form' ? 'form fields' : 'JSON'}.`;
  const extra = fields.filter((f) => !write.fields.includes(f));
  if (extra.length) return `the request to ${write.what} carries ${extra.map((f) => `"${f}"`).join(', ')}, which could change something that already exists.`;
  return null;
}

const jsonKeys = (v: unknown): string[] | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.keys(v) : null);

/** Why ChartKeeper must not send this request, or null when it may. */
export const writeRefusal = (req: HttpRequest): string | null =>
  refusal(req.method, req.url, (kind) => {
    if (kind === 'form') return req.form && req.json === undefined ? Object.keys(req.form) : null;
    return req.form === undefined ? jsonKeys(req.json) : null;
  });

/** One piece of a request body as Chromium hands it over. Files and blobs come without `bytes`. */
export interface UploadPart {
  bytes?: Uint8Array;
}

function uploadText(upload: readonly UploadPart[] | undefined): string | null {
  if (!upload?.length || upload.some((p) => !(p.bytes instanceof Uint8Array))) return null;
  const all = new Uint8Array(upload.reduce((n, p) => n + p.bytes!.length, 0));
  let at = 0;
  for (const p of upload) {
    all.set(p.bytes!, at);
    at += p.bytes!.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(all);
  } catch {
    return null;
  }
}

/** The field names of a multipart body whose every part is a plain text field; null for anything else. */
function multipartFieldNames(body: string): string[] | null {
  const boundary = /^--([!-~]{1,70})\r\n/.exec(body)?.[1];
  if (!boundary) return null;
  const chunks = body.split(`--${boundary}`);
  if (chunks[0] !== '' || !/^--(\r\n)?$/.test(chunks.at(-1)!)) return null;
  const names: string[] = [];
  for (const chunk of chunks.slice(1, -1)) {
    const field = /^\r\nContent-Disposition: form-data; name="([^"\r\n]*)"\r\n\r\n[\s\S]*\r\n$/i.exec(chunk);
    if (!field) return null;
    names.push(field[1]!);
  }
  return names;
}

/** The field names of a raw request body read as `kind`, or null when it cannot be read that way. */
export function uploadFieldNames(kind: BodyKind, upload: readonly UploadPart[] | undefined): string[] | null {
  const text = uploadText(upload);
  if (text === null) return null;
  if (kind === 'form') return multipartFieldNames(text);
  try {
    return jsonKeys(JSON.parse(text));
  } catch {
    return null;
  }
}

/** `writeRefusal` for a request the browser session is about to send, from its raw body. */
export const rawWriteRefusal = (method: string, url: string, upload: readonly UploadPart[] | undefined): string | null =>
  refusal(method, url, (kind) => uploadFieldNames(kind, upload));
