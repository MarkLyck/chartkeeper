import type { ParsedChart, ParsedLayout } from '../../core/layout';
import type { NotShownItem } from './plan';
import { formatCount, intervalLabel, STRINGS } from './strings';

export type NotShownLine =
  /** The items' names in bold, then why; the hover text names each item. */
  | { k: 'items'; names: string; title: string; text: string }
  | { k: 'other-symbols'; text: string };

export interface NotShownSummary {
  count: string;
  /** Closed when everything listed is a drawing on another symbol: nothing is missing from the chart on screen. */
  open: boolean;
  charts: { heading: string | null; lines: NotShownLine[] }[];
}

/** A layout can keep drawings for hundreds of symbols; the line names the ones with the most. */
const SHOWN_SYMBOLS = 20;

/** The symbol of a drawing that is only not shown because it belongs to another symbol. */
const otherSymbolOf = ({ reason: r }: NotShownItem) => (r.code === 'other-symbol' || r.code === 'symbol-not-in-layout' ? r.symbol : null);

const itemTitle = (i: NotShownItem) => `${i.kind === 'drawing' ? STRINGS.drawing : i.kind === 'indicator' ? STRINGS.indicator : STRINGS.chart} ${i.id}`.trim();

function otherSymbolsText(bySymbol: Map<string, number>): string {
  const sorted = [...bySymbol].sort(([a, n], [b, m]) => m - n || a.localeCompare(b));
  const listed = sorted.slice(0, SHOWN_SYMBOLS).map(([symbol, n]) => `${symbol} (${formatCount(n)})`);
  if (sorted.length > SHOWN_SYMBOLS) listed.push(STRINGS.moreSymbols(sorted.length - SHOWN_SYMBOLS));
  return STRINGS.otherSymbols(sorted.reduce((sum, [, n]) => sum + n, 0), sorted.length, listed.join(', '));
}

/** What the "Not shown" list says, chart by chart. Null when everything was drawn. */
export function summarizeNotShown(items: readonly NotShownItem[], charts: readonly Pick<ParsedChart, 'chartId' | 'shortName' | 'interval'>[]): NotShownSummary | null {
  if (items.length === 0) return null;
  const multi = charts.length > 1;
  const sections = charts.flatMap((chart, index) => {
    const forChart = items.filter((i) => i.chartId === chart.chartId);
    if (forChart.length === 0) return [];
    // One line per reason, so a chart without prices doesn't list fifty identical lines.
    const byMessage = new Map<string, NotShownItem[]>();
    const bySymbol = new Map<string, number>();
    for (const item of forChart) {
      const symbol = otherSymbolOf(item);
      if (symbol !== null) bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + 1);
      else byMessage.set(item.message, [...(byMessage.get(item.message) ?? []), item]);
    }
    const lines: NotShownLine[] = [...byMessage].map(([message, group]) => ({ k: 'items', names: group.map((i) => i.name).join(', '), title: group.map(itemTitle).join('\n'), text: message }));
    if (bySymbol.size) lines.push({ k: 'other-symbols', text: otherSymbolsText(bySymbol) });
    return [{ heading: multi ? `${STRINGS.chart} ${index + 1} · ${chart.shortName} · ${intervalLabel(chart.interval)}` : null, lines }];
  });
  return { count: formatCount(items.length), open: items.some((i) => otherSymbolOf(i) === null), charts: sections };
}

/** The "Not shown" list under the charts. Returns null when everything was drawn. */
export function notShownPanel(items: readonly NotShownItem[], layout: ParsedLayout, dark: boolean): HTMLElement | null {
  const summary = summarizeNotShown(items, layout.charts);
  if (!summary) return null;
  const panel = document.createElement('details');
  panel.className = 'ck-not-shown';
  panel.open = summary.open;
  panel.style.cssText = [
    'flex:none',
    'max-height:30%',
    'overflow:auto',
    'padding:6px 12px',
    'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    `background:${dark ? '#1e222d' : '#f8f9fd'}`,
    `color:${dark ? '#d1d4dc' : '#131722'}`,
    `border-top:1px solid ${dark ? '#2a2e39' : '#e0e3eb'}`,
  ].join(';');

  const head = document.createElement('summary');
  head.textContent = `${STRINGS.notShown} (${summary.count})`;
  head.style.cssText = 'cursor:pointer;font-weight:600;';
  panel.append(head);

  for (const chart of summary.charts) {
    if (chart.heading) {
      const h = document.createElement('div');
      h.textContent = chart.heading;
      h.style.cssText = 'margin-top:6px;font-weight:600;opacity:0.8;';
      panel.append(h);
    }
    const list = document.createElement('ul');
    list.style.cssText = 'margin:4px 0;padding-left:18px;';
    for (const line of chart.lines) {
      const li = document.createElement('li');
      if (line.k === 'items') {
        const names = document.createElement('strong');
        names.textContent = line.names;
        names.title = line.title;
        li.append(names, document.createTextNode(`: ${line.text}`));
      } else li.textContent = line.text;
      list.append(li);
    }
    panel.append(list);
  }
  return panel;
}
