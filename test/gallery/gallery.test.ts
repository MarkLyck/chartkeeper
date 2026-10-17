import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countLayout } from '../../src/core/layout';
import { SnapshotReader } from '../../src/core/snapshot';
import { openLayout } from '../../src/core/snapshotView';
import { CHART_STYLES, LINE_TOOL_TYPES, NOT_CAPTURABLE, SIGNED_OUT_STUDIES } from './catalog';
import { SCENES } from './scenes';

const GALLERY = path.resolve(__dirname, '../fixtures/gallery');

interface Index {
  scenes: { name: string; dir: string; uid: string; drawings: { id: string; type: string; image: string }[]; charts: { chartId: string; style: number; studies: string[] }[] }[];
  coverage: { drawingTools: { type: string; scenes: string[]; notCapturable: string | null }[]; chartStyles: { id: number; scenes: string[]; notCapturable: string | null }[] };
}

const index: Index = JSON.parse(readFileSync(path.join(GALLERY, 'index.json'), 'utf8'));

describe('gallery scene specs', () => {
  it('ask for every drawing tool a signed-out chart can show', () => {
    const asked = new Set(SCENES.flatMap((s) => s.charts.flatMap((c) => c.drawings.map((d) => d.type))));
    expect(LINE_TOOL_TYPES.filter((t) => !asked.has(t) && !NOT_CAPTURABLE[t])).toEqual([]);
    expect(LINE_TOOL_TYPES.filter((t) => asked.has(t) && NOT_CAPTURABLE[t])).toEqual([]);
  });

  it('ask for every free chart style and every signed-out indicator', () => {
    const styles = new Set(SCENES.flatMap((s) => s.charts.map((c) => c.style)));
    expect(CHART_STYLES.filter((s) => !('paid' in s) && !styles.has(s.id)).map((s) => s.name)).toEqual([]);
    const studies = new Set(SCENES.flatMap((s) => s.charts.flatMap((c) => c.studies.map((st) => st.name))));
    expect(SIGNED_OUT_STUDIES.filter((s) => !studies.has(s))).toEqual([]);
  });
});

describe('captured gallery', () => {
  it('has a capture for every scene', () => {
    expect(index.scenes.map((s) => s.name).sort()).toEqual(SCENES.map((s) => s.name).sort());
  });

  it('covers every drawing tool and chart style or says why not', () => {
    expect(index.coverage.drawingTools).toHaveLength(LINE_TOOL_TYPES.length);
    expect(index.coverage.drawingTools.filter((t) => !t.scenes.length && !t.notCapturable).map((t) => t.type)).toEqual([]);
    expect(index.coverage.chartStyles).toHaveLength(CHART_STYLES.length);
    expect(index.coverage.chartStyles.filter((s) => !s.scenes.length && !s.notCapturable).map((s) => s.id)).toEqual([]);
  });

  describe.each(index.scenes.map((s) => [s.name, s] as const))('%s', (_name, scene) => {
    const dir = path.join(GALLERY, scene.dir);

    it('is an intact snapshot whose drawings match the isolated images', async () => {
      const reader = await SnapshotReader.open(dir);
      expect(await reader.verify()).toEqual([]);
      const { layout, data } = await openLayout(reader, scene.uid);
      const counts = countLayout(layout);
      expect(counts.drawingIds).toEqual(scene.drawings.map((d) => d.id).sort());
      for (const chart of layout.charts) {
        const bars = data[chart.chartId]?.bars ?? [];
        expect(bars.length, `bars of chart ${chart.chartId}`).toBeGreaterThan(20);
      }
      for (const img of ['tradingview.png', 'isolated/_base.png', ...scene.drawings.map((d) => d.image)]) expect(existsSync(path.join(dir, img)), img).toBe(true);
    });
  });
});
