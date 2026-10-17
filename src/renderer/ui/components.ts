import type { AppError } from '../../shared/api';
import { explainError, t } from '../i18n';
import { h, type Child } from './dom';
import type { Ctx } from './screen';

type ButtonKind = 'primary' | 'secondary' | 'link' | 'danger';

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

/** The heading row of every screen except home. Focus lands on the title so screen readers announce the new screen. */
export function screenHeader(ctx: Ctx, title: string, opts: { canLeave?: boolean } = {}): HTMLElement {
  return h('header', { class: 'screen-header' },
    opts.canLeave === false ? null : button(`← ${t('nav.home')}`, () => ctx.go({ name: 'home' }), { kind: 'link', id: 'nav-home' }),
    h('h1', { tabIndex: -1, class: 'screen-title' }, title));
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
      h('h2', { class: 'result-title' }, title ?? text.title),
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

/** A modal yes/no question. Resolves true only for an explicit yes. */
export function confirmDialog(opts: { title: string; body: string; yes: string; no: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog', attrs: { 'aria-labelledby': 'dialog-title' } });
    const close = (answer: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    dialog.append(
      h('h2', { id: 'dialog-title', class: 'dialog-title' }, opts.title),
      h('p', {}, opts.body),
      h('div', { class: 'actions actions-end' },
        button(opts.no, () => close(false), { id: 'dialog-no' }),
        button(opts.yes, () => close(true), { kind: opts.danger ? 'danger' : 'primary', id: 'dialog-yes' })),
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    (dialog.querySelector('#dialog-no') as HTMLButtonElement).focus();
  });
}
