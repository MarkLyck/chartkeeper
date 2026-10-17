export type Child = Node | string | number | null | undefined | false;

type Props = {
  class?: string;
  /** Event listeners, keyed by event name. */
  on?: { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };
  /** Attributes such as aria-*, role, for. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  [prop: string]: unknown;
};

/**
 * Creates an element. String children become text nodes, so names and
 * messages from TradingView or the backup are never parsed as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, on, attrs, ...rest } = props;
  if (cls) el.className = cls;
  for (const [name, fn] of Object.entries(on ?? {})) el.addEventListener(name, fn as EventListener);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  Object.assign(el, rest);
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

/**
 * Replaces an element's content. If focus was inside, it moves to the new
 * element with the same id, so re-rendering after a click or a settings
 * change does not throw keyboard users back to the top.
 */
export function replace(el: Element, ...children: (Child | Child[])[]): void {
  const active = document.activeElement;
  const focusedId = active && el.contains(active) && active.id ? active.id : null;
  el.replaceChildren();
  append(el, children);
  if (focusedId) (document.getElementById(focusedId) as HTMLElement | null)?.focus();
}
