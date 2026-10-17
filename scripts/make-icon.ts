/** Renders build/icon.png (1024×1024) from SVG, so the icon can be changed and re-made. Run: npx tsx scripts/make-icon.ts */
import path from 'node:path';
import { chromium } from 'playwright-core';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e4fd8"/><stop offset="1" stop-color="#0d2f8f"/></linearGradient></defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/>
  <path d="M512 170 L790 270 V500 C790 680 670 800 512 860 C354 800 234 680 234 500 V270 Z" fill="#ffffff" opacity="0.14"/>
  <g stroke-linecap="round">
    <line x1="352" y1="330" x2="352" y2="690" stroke="#ef5350" stroke-width="20"/>
    <rect x="312" y="420" width="80" height="190" rx="14" fill="#ef5350"/>
    <line x1="512" y1="270" x2="512" y2="640" stroke="#26a69a" stroke-width="20"/>
    <rect x="472" y="330" width="80" height="230" rx="14" fill="#26a69a"/>
    <line x1="672" y1="300" x2="672" y2="600" stroke="#26a69a" stroke-width="20"/>
    <rect x="632" y="360" width="80" height="160" rx="14" fill="#26a69a"/>
    <line x1="270" y1="700" x2="760" y2="330" stroke="#ffb300" stroke-width="26"/>
  </g>
</svg>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.resolve(__dirname, '../build/icon.png'), omitBackground: true });
  await browser.close();
}
void main();
