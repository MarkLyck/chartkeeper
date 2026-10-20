import type { SafariCookie } from '../../src/main/safariSignIn';

/** Writes cookies the way WebKit lays out a `.binarycookies` file, one page per inner list. */
export function writeBinaryCookies(pages: SafariCookie[][]): Buffer {
  const encoded = pages.map((cookies) => {
    const records = cookies.map((c) => {
      const strings = [c.domain, c.name, c.path, c.value].map((s) => Buffer.from(`${s}\0`, 'utf8'));
      const head = Buffer.alloc(56);
      head.writeUInt32LE(56 + strings.reduce((n, s) => n + s.length, 0), 0);
      head.writeUInt32LE((c.secure ? 1 : 0) | (c.httpOnly ? 4 : 0) | 0x4230, 8);
      let at = 56;
      strings.forEach((s, i) => {
        head.writeUInt32LE(at, 16 + i * 4);
        at += s.length;
      });
      head.writeDoubleLE(c.expires - 978307200, 40);
      head.writeDoubleLE(Date.now() / 1000 - 978307200, 48);
      return Buffer.concat([head, ...strings]);
    });
    const header = Buffer.alloc(8 + records.length * 4 + 4);
    header.writeUInt32BE(0x100, 0);
    header.writeUInt32LE(records.length, 4);
    let at = header.length;
    records.forEach((r, i) => {
      header.writeUInt32LE(at, 8 + i * 4);
      at += r.length;
    });
    return Buffer.concat([header, ...records]);
  });
  const head = Buffer.alloc(8 + encoded.length * 4);
  head.write('cook', 0, 'latin1');
  head.writeUInt32BE(encoded.length, 4);
  encoded.forEach((p, i) => head.writeUInt32BE(p.length, 8 + i * 4));
  return Buffer.concat([head, ...encoded, Buffer.alloc(8)]);
}

export const tvCookie = (name: string, value: string, extra: Partial<SafariCookie> = {}): SafariCookie => ({
  name,
  value,
  domain: '.tradingview.com',
  path: '/',
  expires: Math.round(Date.now() / 1000) + 30 * 86400,
  secure: true,
  httpOnly: name === 'sessionid',
  ...extra,
});
