import geist from './fonts/Geist-Variable.woff2';
import serif from './fonts/InstrumentSerif-Regular.woff2';

/**
 * The window's two typefaces, Geist and Instrument Serif (both SIL OFL 1.1,
 * see licenses/), inlined so they work offline. Resolves once both are
 * loaded, or failed and left to the system fallback.
 */
export function loadFonts(): Promise<void> {
  const faces = [new FontFace('Geist', `url(${geist})`, { weight: '100 900' }), new FontFace('Instrument Serif', `url(${serif})`)];
  for (const f of faces) document.fonts.add(f);
  return Promise.allSettled(faces.map((f) => f.load())).then(() => undefined);
}
