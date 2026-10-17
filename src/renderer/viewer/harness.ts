/** Standalone page entry used by scripts/viewer-compare.ts; not part of the app bundle. */
import type { ParsedLayout } from '../../core/layout';
import type { ChartData } from '../../core/model';
import { planLayout, renderLayout, type RenderOptions } from './index';

interface HarnessInput {
  layout: ParsedLayout;
  data: Record<string, ChartData | null>;
  options: RenderOptions;
}

const w = window as unknown as { __CK_INPUT__: HarnessInput; __CK_RESULT__?: unknown };
const input = w.__CK_INPUT__;
const result = renderLayout(document.getElementById('root')!, input.layout, input.data, input.options);
const plan = planLayout(input.layout, input.data, input.options.lang);
w.__CK_RESULT__ = {
  notShown: result.notShown,
  rendered: plan.charts.map((c) => ({ chartId: c.chart.chartId, ...c.rendered })),
};
