/** Renders build/icon.png (1024×1024) from SVG, so the icon can be changed and re-made. Run: npx tsx scripts/make-icon.ts */
import path from 'node:path';
import { chromium } from 'playwright-core';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27272a"/><stop offset="1" stop-color="#09090b"/></linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/>
  <path d="M232 646 L410 468 L540 598 L792 330" fill="none" stroke="#ffffff" stroke-width="72" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.resolve(__dirname, '../build/icon.png'), omitBackground: true });
  await browser.close();
}
void main();
