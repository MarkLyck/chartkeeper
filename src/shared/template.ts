/** The `{name}` placeholders of a message template, as a type. */
export type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | ParamNames<Rest> : never;

export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) {
      console.error(`i18n: missing param {${name}} in "${template}"`);
      return '';
    }
    return String(value);
  });
}
