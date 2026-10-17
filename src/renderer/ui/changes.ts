import type { Change, NamedKind, PropChange } from '../../core/diff';
import type { DrawingPoint } from '../../core/layout';
import type { TemplateKind } from '../../core/restore';
import { getLang, t, type Key } from '../i18n';
import { drawingName } from '../viewer/strings';

const points = (ps: DrawingPoint[]) => ps.map((p) => `${new Date(p.time * 1000).toISOString().slice(0, 10)} @ ${+p.price.toFixed(6)}`).join(', ');
const props = (ps: PropChange[]) => ps.map((p) => `${p.key}: ${p.from ?? '–'} → ${p.to ?? '–'}`).join('; ');
const tool = (type: string) => drawingName(type, getLang());

const NAMED = {
  'study-template': 'change.studyTemplate',
  'drawing-template': 'change.drawingTemplate',
  theme: 'change.theme',
  script: 'change.script',
} as const satisfies Record<NamedKind, Key>;

/** One change from the backup comparison, in the user's language. */
export function changeText(c: Change): { subject: string; detail: string } {
  switch (c.what) {
    case 'layout-name':
      return { subject: t('change.layout'), detail: t('change.renamed', { from: c.from, to: c.to }) };
    case 'arrangement':
      return { subject: t('change.layout'), detail: t('change.arrangement', { from: c.from, to: c.to }) };
    case 'chart':
      return { subject: t('change.chart', { n: c.index + 1 }), detail: `${c.symbol} ${c.interval}` };
    case 'chart-symbol':
      return { subject: t('change.chart', { n: c.index + 1 }), detail: t('change.symbol', { from: c.from, to: c.to }) };
    case 'chart-interval':
      return { subject: t('change.chart', { n: c.index + 1 }), detail: t('change.interval', { from: c.from, to: c.to }) };
    case 'chart-style':
      return { subject: t('change.chart', { n: c.index + 1 }), detail: t('change.chartType') };
    case 'study':
      return { subject: t('change.indicator', { name: c.shortName }), detail: c.name };
    case 'study-inputs':
      return { subject: t('change.indicator', { name: c.shortName }), detail: t('change.settings', { list: props(c.inputs) }) };
    case 'study-style':
      return { subject: t('change.indicator', { name: c.shortName }), detail: t('change.styles') };
    case 'drawing': {
      const where = { tool: tool(c.toolType), symbol: c.symbol ?? t('change.theChart'), points: points(c.points) };
      return { subject: where.tool, detail: c.text ? t('change.drawingWithText', { ...where, text: c.text }) : t('change.drawingOn', where) };
    }
    case 'drawing-moved':
      return { subject: tool(c.toolType), detail: t('change.moved', { from: points(c.from), to: points(c.to) }) };
    case 'drawing-props': {
      const more = c.props.length > 6 ? ` ${t('change.more', { n: c.props.length - 6 })}` : '';
      return { subject: tool(c.toolType), detail: t('change.props', { list: props(c.props.slice(0, 6)) }) + more };
    }
    case 'drawing-template':
      return { subject: t(NAMED[c.what]), detail: `${c.name} (${tool(c.toolType)})` };
    default:
      return { subject: t(NAMED[c.what]), detail: c.name };
  }
}

const TEMPLATE_ITEM = { 'study-template': 'restore.templateStudy', 'drawing-template': 'restore.templateDrawing', theme: 'restore.templateTheme' } as const satisfies Record<TemplateKind, Key>;
const TEMPLATE_MISSING = { 'study-template': 'restore.missingStudy', 'drawing-template': 'restore.missingDrawing', theme: 'restore.missingTheme' } as const satisfies Record<TemplateKind, Key>;

export const templateItemText = (item: { kind: TemplateKind; name: string }): string => t(TEMPLATE_ITEM[item.kind], { name: item.name });
export const templateMissingText = (kind: TemplateKind): string => t(TEMPLATE_MISSING[kind]);
