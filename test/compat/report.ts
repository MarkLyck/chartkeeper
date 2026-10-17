import type { Difference, FeatureCheck, Stage } from './features';
import { KNOWN_TRADINGVIEW_REWRITES, type KnownRewrite } from './knownRewrites';

export type Verdict = 'PASS' | 'KNOWN' | 'FAIL';

export interface StageRun {
  stage: Stage;
  layout: string;
  checks: FeatureCheck[];
  /** The stage could not run at all (e.g. TradingView's loader threw). */
  error?: string;
}

export interface Classified extends FeatureCheck {
  stage: Stage;
  verdict: Verdict;
  unexplained: Difference[];
  known: KnownRewrite[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const matches = (r: KnownRewrite, c: FeatureCheck, d: Difference) => r.layout === c.layout && r.feature === c.feature && r.path === d.path && same(r.expected, d.expected) && same(r.actual, d.actual);

/** Only TradingView's own loader may rewrite values, and only exactly as listed in knownRewrites.ts. */
export function classify(run: StageRun): Classified[] {
  return run.checks.map((c) => {
    const known: KnownRewrite[] = [];
    const unexplained: Difference[] = [];
    for (const d of c.differences) {
      const rewrite = run.stage === 'tradingview' ? KNOWN_TRADINGVIEW_REWRITES.find((r) => matches(r, c, d)) : undefined;
      if (rewrite) known.push(rewrite);
      else unexplained.push(d);
    }
    return { ...c, stage: run.stage, verdict: unexplained.length ? 'FAIL' : known.length ? 'KNOWN' : 'PASS', unexplained, known };
  });
}

/** Rewrites marked `always` that TradingView did not do. The list must describe today's TradingView, so these are reported too. */
export function staleRewrites(tradingview: Classified[]): KnownRewrite[] {
  const seen = new Set(tradingview.flatMap((c) => c.known));
  return KNOWN_TRADINGVIEW_REWRITES.filter((r) => r.always && !seen.has(r));
}

const show = (v: unknown) => (v === undefined ? '(missing)' : JSON.stringify(v));
const cell = (c: Classified | undefined) => (c ? c.verdict : 'not run');

export function renderMarkdown(runs: StageRun[], meta: { tradingViewBuild: string | null; date: string; unsupported: Record<string, string> }): string {
  const all = runs.flatMap(classify);
  const stale = staleRewrites(all.filter((c) => c.stage === 'tradingview'));
  const stages: Stage[] = ['snapshot', 'payload', 'tradingview'];
  const lines: string[] = [];
  lines.push('# Restore keeps every feature', '');
  lines.push(`Run ${meta.date} against tradingview.com build ${meta.tradingViewBuild ?? 'unknown'} (signed out).`, '');
  lines.push('Stages: **snapshot** is the backup on disk read back with parseLayout. **payload** is the content restore sent to the save endpoint. **tradingview** is what TradingView\'s own loader kept, read back with its serializer.', '');
  lines.push('Limits: a signed-out chart shows only the first chart of a multi-chart layout, so later charts go through the loader and serializer without being drawn. Signed-in loading is checked by `npm run test:live`.', '');
  lines.push('| Stage | Features | PASS | KNOWN | FAIL |', '| --- | --- | --- | --- | --- |');
  for (const stage of stages) {
    const s = all.filter((c) => c.stage === stage);
    const n = (v: Verdict) => s.filter((c) => c.verdict === v).length;
    lines.push(`| ${stage} | ${s.length} | ${n('PASS')} | ${n('KNOWN')} | ${n('FAIL')} |`);
  }
  lines.push('');
  for (const run of runs.filter((r) => r.error)) lines.push(`**${run.stage} for ${run.layout} did not run:** ${run.error}`, '');
  if (Object.keys(meta.unsupported).length) {
    lines.push('Not covered, because a signed-out chart cannot load them at all:', '');
    for (const [tool, why] of Object.entries(meta.unsupported)) lines.push(`- ${tool}: ${why}`);
    lines.push('');
  }
  const problems = all.filter((c) => c.verdict !== 'PASS');
  if (problems.length) {
    lines.push('## Differences', '');
    for (const c of problems) {
      lines.push(`### ${c.verdict} ${c.stage}: ${c.feature} (${c.layout})`, '');
      for (const d of c.unexplained) lines.push(`- \`${d.path || '(feature)'}\`: expected ${show(d.expected)}, got ${show(d.actual)}`);
      for (const k of c.known) lines.push(`- known TradingView rewrite \`${k.path}\`: ${show(k.expected)} becomes ${show(k.actual)}. ${k.why}`);
      lines.push('');
    }
  }
  if (stale.length) {
    lines.push('## Stale known rewrites (TradingView no longer does these; remove them from knownRewrites.ts)', '');
    for (const k of stale) lines.push(`- ${k.layout} ${k.feature} \`${k.path}\``);
    lines.push('');
  }
  const keyed = new Map<string, Map<Stage, Classified>>();
  for (const c of all) {
    const key = `${c.layout}|${c.kind}|${c.feature}`;
    if (!keyed.has(key)) keyed.set(key, new Map());
    keyed.get(key)!.set(c.stage, c);
  }
  lines.push('## Every feature', '', '| Layout | Kind | Feature | snapshot | payload | tradingview |', '| --- | --- | --- | --- | --- | --- |');
  for (const [key, byStage] of keyed) {
    const [layout, kind, feature] = key.split('|');
    lines.push(`| ${layout} | ${kind} | ${feature} | ${stages.map((s) => cell(byStage.get(s))).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}
