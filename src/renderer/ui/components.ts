import type { AppError } from '../../shared/api';
import { explainError, t } from '../i18n';
import { h, type Child } from './dom';
import type { Ctx, Route } from './screen';

type ButtonKind = 'primary' | 'secondary' | 'link';

export function button(label: string, onClick: () => void, opts: { kind?: ButtonKind; id?: string; disabled?: boolean; big?: boolean } = {}): HTMLButtonElement {
  const kind = opts.kind ?? 'secondary';
  return h('button', {
    type: 'button',
    class: `btn btn-${kind}${opts.big ? ' btn-big' : ''}`,
    id: opts.id ?? '',
    disabled: opts.disabled ?? false,
    on: { click: onClick },
  }, label);
}

/**
 * The bar across the top of every screen: the name, the three places to go,
 * and who is signed in. While a backup or restore runs the places are left
 * out, so it can't be walked away from by accident.
 */
export function topBar(ctx: Ctx, active: Route['name'], opts: { canLeave?: boolean } = {}): HTMLElement {
  const s = ctx.state();
  const locked = !s.signedIn || s.busy !== null;
  const link = (name: 'home' | 'view' | 'restore', label: string, disabled = false) =>
    h('button', {
      type: 'button',
      id: `nav-${name}`,
      class: `nav-link${name === active ? ' nav-active' : ''}`,
      disabled,
      attrs: { 'aria-current': name === active ? 'page' : undefined },
      on: { click: () => ctx.go({ name }) },
    }, label);
  return h('header', { class: 'topbar', attrs: { 'data-active': active, 'data-can-leave': String(opts.canLeave !== false) } },
    h('div', { class: 'topbar-inner' },
      h('span', { class: 'brand' }, brandMark(), 'ChartKeeper'),
      opts.canLeave === false
        ? h('span', { class: 'nav' })
        : h('nav', { class: 'nav', attrs: { 'aria-label': t('nav.label') } },
            link('home', t('nav.home')),
            link('view', t('nav.backups')),
            link('restore', t('nav.restore'), locked && active !== 'restore')),
      h('span', { class: 'account' },
        h('span', { class: `dot ${s.signedIn ? 'dot-ok' : 'dot-off'}`, attrs: { 'aria-hidden': 'true' } }),
        s.signedIn ? (s.username ?? t('nav.signedIn')) : t('nav.signedOut'))));
}

/** Redraws the top bar inside `root` for a new app state, keeping the screen and the lock it was drawn with. */
export function refreshTopBar(ctx: Ctx, root: Element): void {
  const bar = root.querySelector<HTMLElement>('.topbar');
  if (!bar) return;
  const focused = bar.contains(document.activeElement) ? document.activeElement?.id : null;
  bar.replaceWith(topBar(ctx, bar.dataset.active as Route['name'], { canLeave: bar.dataset.canLeave === 'true' }));
  if (focused) document.getElementById(focused)?.focus();
}

/** The page's own heading. Focus lands on it so screen readers announce the new screen; `spoken` goes before the title for them only. */
export function pageTitle(title: string, spoken?: string): HTMLElement {
  return h('div', { class: 'page-head' }, h('h1', { tabIndex: -1, class: 'screen-title' }, spoken ? h('span', { class: 'sr-only' }, spoken) : null, title));
}

/**
 * A line of `values` across the full width, the way a balance's history is
 * drawn under it. Points are spread evenly; null for fewer than two.
 */
export function sparkline(values: number[], label: string): HTMLElement | null {
  if (values.length < 2) return null;
  const [w, hgt, pad] = [1000, 120, 10];
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * w, span === 0 ? hgt / 2 : hgt - pad - ((v - lo) / span) * (hgt - 2 * pad)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('class', 'spark');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.innerHTML = `<defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#09090b" stop-opacity="0.12"/><stop offset="1" stop-color="#09090b" stop-opacity="0"/></linearGradient></defs>`
    + `<path class="spark-area" d="${line}L${w} ${hgt}L0 ${hgt}Z"/><path class="spark-line" d="${line}"/>`;
  return h('figure', { class: 'spark-wrap' }, el, h('figcaption', { class: 'note' }, label));
}

function brandMark(): SVGSVGElement {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', 'brand-mark');
  el.innerHTML = '<rect width="24" height="24" rx="7"/><path d="M5.5 15.5l4-4 3 3 6-6.5"/>';
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(paths: string[], cls: string): SVGSVGElement {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', '0 0 48 48');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', cls);
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    el.append(p);
  }
  return el;
}

export const icons = {
  check: () => svg(['M24 4a20 20 0 1 0 0 40a20 20 0 1 0 0-40z', 'M14 25l7 7l13-15'], 'icon icon-check'),
  cross: () => svg(['M24 4a20 20 0 1 0 0 40a20 20 0 1 0 0-40z', 'M17 17l14 14M31 17l-14 14'], 'icon icon-cross'),
  warn: () => svg(['M24 5l21 37H3z', 'M24 19v11M24 35v1'], 'icon icon-warn'),
  zoomIn: () => svg(['M22 6a16 16 0 1 0 0 32a16 16 0 1 0 0-32z', 'M42 42l-8.7-8.7', 'M16 22h12M22 16v12'], 'tool-icon'),
  zoomOut: () => svg(['M22 6a16 16 0 1 0 0 32a16 16 0 1 0 0-32z', 'M42 42l-8.7-8.7', 'M16 22h12'], 'tool-icon'),
  reset: () => svg(['M4 8v12h12', 'M9 30a18 18 0 1 0 4.26-18.72L4 20'], 'tool-icon'),
  expand: () => svg(['M16 6h-6a4 4 0 0 0-4 4v6', 'M42 16v-6a4 4 0 0 0-4-4h-6', 'M32 42h6a4 4 0 0 0 4-4v-6', 'M6 32v6a4 4 0 0 0 4 4h6'], 'tool-icon'),
  collapse: () => svg(['M16 6v6a4 4 0 0 1-4 4H6', 'M42 16h-6a4 4 0 0 1-4-4V6', 'M32 42v-6a4 4 0 0 1 4-4h6', 'M6 32h6a4 4 0 0 1 4 4v6'], 'tool-icon'),
  prev: () => svg(['M30 36L18 24l12-12'], 'tool-icon'),
  next: () => svg(['M18 36l12-12-12-12'], 'tool-icon'),
};

export type Tone = 'success' | 'warning' | 'error' | 'info';

export function notice(tone: Tone, title: string, ...body: Child[]): HTMLElement {
  return h('section', { class: `notice notice-${tone}`, attrs: { role: tone === 'error' ? 'alert' : 'status' } },
    h('h2', { class: 'notice-title' }, title),
    ...body);
}

export function details(summary: string, ...content: Child[]): HTMLDetailsElement {
  return h('details', { class: 'details' }, h('summary', {}, summary), h('div', { class: 'details-body' }, ...content));
}

/** A failure in plain words, the English technical text tucked under "Details", and the action that fixes it. */
export function errorBox(ctx: Ctx, error: AppError, opts: { title?: string; note?: Child; actions?: Child[] } = {}): HTMLElement {
  const { title, note, actions = [] } = opts;
  const text = explainError(error);
  const signIn = error.kind === 'not-signed-in' ? button(t('error.signInAgain'), () => ctx.go({ name: 'home', startSignIn: true }), { kind: 'primary', id: 'err-signin' }) : null;
  return h('section', { class: 'result result-error', attrs: { role: 'alert' } },
    icons.cross(),
    h('div', { class: 'result-body' },
      h('h2', { class: 'result-title', tabIndex: -1 }, title ?? text.title),
      title ? h('p', { class: 'result-lead' }, h('strong', {}, text.title)) : null,
      h('p', {}, text.body),
      note ? h('p', { class: 'note' }, note) : null,
      signIn || actions.some(Boolean) ? h('div', { class: 'actions' }, signIn, ...actions) : null,
      error.message ? details(t('error.details'), h('pre', { class: 'tech' }, error.message)) : null));
}

export function progressBar(fraction: number | null, label: string): HTMLElement {
  const pct = fraction === null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return h('div', { class: 'progress-wrap' },
    h('div', {
      class: `progress${pct === null ? ' progress-indeterminate' : ''}`,
      attrs: { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct ?? undefined },
    }, h('div', { class: 'progress-fill', style: pct === null ? '' : `width:${pct}%` })),
    h('p', { class: 'progress-label', attrs: { 'aria-live': 'polite' } }, label));
}

export function toggle(id: string, label: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', id, checked, class: 'switch-input', attrs: { role: 'switch' }, on: { change: () => onChange(input.checked) } });
  return h('label', { class: 'switch', htmlFor: id }, input, h('span', { class: 'switch-track', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'switch-label' }, label));
}

export function spinner(label: string): HTMLElement {
  return h('p', { class: 'loading', attrs: { role: 'status' } }, h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }), label);
}

