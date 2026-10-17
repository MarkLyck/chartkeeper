import fontUrl from 'font-awesome/fonts/fontawesome-webfont.woff2';

/**
 * TradingView's icon drawings store Font Awesome 4.7 code points, so the
 * viewer draws them with that font (SIL OFL 1.1, see licenses/), inlined in
 * the bundle so it works offline.
 */
export const ICON_FONT_FAMILY = 'ChartKeeper Font Awesome';

let ready: Promise<void> | null = null;

/** Loads the icon font once; resolves when canvas text can use it (or right away where fonts can't load). */
export function iconFontReady(): Promise<void> {
  if (ready) return ready;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return (ready = Promise.resolve());
  const face = new FontFace(ICON_FONT_FAMILY, `url(${fontUrl})`);
  document.fonts.add(face);
  return (ready = face.load().then(
    () => undefined,
    () => undefined,
  ));
}
