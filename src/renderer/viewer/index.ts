import type { ParsedLayout } from '../../core/layout';
import type { ChartData } from '../../core/model';
import { applyGrid, arrangementGrid } from './arrangement';
import { chartTheme, renderChart, type RenderedChart } from './chart';
import { notShownPanel } from './panel';
import { planLayout, type NotShownItem } from './plan';

export type { NotShownItem } from './plan';
export { planChart, planLayout } from './plan';
export type { NotShownReason } from './strings';

export interface RenderOptions {
  /** Unix seconds; `to` may lie past the last bar. Defaults to about the last 150 bars. */
  visibleRange?: { from: number; to: number };
  /** Price range of each chart's main pane, instead of fitting the visible bars. */
  priceRange?: { from: number; to: number };
  /** Price axis width in pixels, instead of sizing it for its labels as TradingView does (labels measure differently with other fonts). */
  priceAxisWidth?: number;
  /** Show the "Not shown" panel under the charts. Defaults to true. */
  notShownPanel?: boolean;
}

export interface RenderedLayout {
  destroy(): void;
  /** Everything in the layout the viewer did not draw, with a plain-language reason. */
  notShown: NotShownItem[];
}

/** Draws a backed-up layout into `container`: every chart in TradingView's arrangement, plus a "Not shown" panel when needed. */
export function renderLayout(container: HTMLElement, layout: ParsedLayout, data: Record<string, ChartData | null>, options: RenderOptions = {}): RenderedLayout {
  const plan = planLayout(layout, data);
  const root = document.createElement('div');
  root.className = 'ck-viewer';
  root.style.cssText = `display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Trebuchet MS',Roboto,Ubuntu,sans-serif;`;
  const grid = document.createElement('div');
  grid.style.cssText = 'flex:1 1 auto;min-height:0;gap:1px;';
  const firstTheme = chartTheme(layout.charts[0]?.chartProperties ?? {});
  grid.style.background = firstTheme.dark ? '#2a2e39' : '#e0e3eb';
  root.append(grid);
  container.append(root);

  const cells = plan.charts.map(() => {
    const cell = document.createElement('div');
    cell.style.cssText = 'min-width:0;min-height:0;overflow:hidden;';
    grid.append(cell);
    return cell;
  });
  applyGrid(grid, cells, arrangementGrid(layout.arrangement, plan.charts.length));

  const panel = options.notShownPanel === false ? null : notShownPanel(plan.notShown, layout, firstTheme.dark);
  if (panel) root.append(panel);

  const charts: RenderedChart[] = plan.charts.map((c, i) => renderChart(cells[i]!, c, options));
  return {
    notShown: plan.notShown,
    destroy() {
      for (const c of charts) c.destroy();
      root.remove();
    },
  };
}
