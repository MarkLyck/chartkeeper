import type { ParsedLayout } from '../../core/layout';
import type { NotShownItem } from './plan';
import { intervalLabel, STRINGS } from './strings';

/** The "Not shown" list under the charts. Returns null when everything was drawn. */
export function notShownPanel(items: readonly NotShownItem[], layout: ParsedLayout, dark: boolean): HTMLElement | null {
  if (items.length === 0) return null;
  const panel = document.createElement('details');
  panel.className = 'ck-not-shown';
  panel.open = true;
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

  const summary = document.createElement('summary');
  summary.textContent = `${STRINGS.notShown} (${items.length})`;
  summary.style.cssText = 'cursor:pointer;font-weight:600;';
  panel.append(summary);

  const multi = layout.charts.length > 1;
  layout.charts.forEach((chart, index) => {
    const forChart = items.filter((i) => i.chartId === chart.chartId);
    if (forChart.length === 0) return;
    if (multi) {
      const h = document.createElement('div');
      h.textContent = `${STRINGS.chart} ${index + 1} · ${chart.shortName} · ${intervalLabel(chart.interval)}`;
      h.style.cssText = 'margin-top:6px;font-weight:600;opacity:0.8;';
      panel.append(h);
    }
    const list = document.createElement('ul');
    list.style.cssText = 'margin:4px 0;padding-left:18px;';
    // One line per reason, so a chart without prices doesn't list fifty identical lines.
    const byMessage = new Map<string, NotShownItem[]>();
    for (const item of forChart) byMessage.set(item.message, [...(byMessage.get(item.message) ?? []), item]);
    for (const [message, group] of byMessage) {
      const li = document.createElement('li');
      const names = document.createElement('strong');
      names.textContent = group.map((i) => i.name).join(', ');
      names.title = group.map((i) => `${i.kind === 'drawing' ? STRINGS.drawing : i.kind === 'indicator' ? STRINGS.indicator : STRINGS.chart} ${i.id}`.trim()).join('\n');
      li.append(names, document.createTextNode(`: ${message}`));
      list.append(li);
    }
    panel.append(list);
  });
  return panel;
}
