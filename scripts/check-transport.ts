/**
 * Electron entry that checks the hidden-page transport against the real
 * tradingview.com while signed out: requests, blocked hosts, and that a call
 * fails (instead of hanging) when its page closes or stops answering.
 *   npx esbuild scripts/check-transport.ts --bundle --platform=node --format=cjs --external:electron --outfile=.test-output/check-transport.js
 *   env -u ELECTRON_RUN_AS_NODE npx electron .test-output/check-transport.js
 */
import { app } from 'electron';
import { appendFileSync } from 'node:fs';

const say = (line: string) => appendFileSync(process.env.CHECK_LOG ?? '/dev/stdout', line + '\n');
import { urls } from '../src/core/tv/endpoints';
import { ElectronPageTransport, tvSession } from '../src/main/tvSession';

const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true, v: String(v) }), (e: Error) => ({ ok: false, v: e.message }));

// Like the app: closing the last hidden window must not quit.
app.on('window-all-closed', () => undefined);
app.whenReady().then(async () => {
  say('ready');
  const blocked: string[] = [];
  tvSession().webRequest.onErrorOccurred((d) => d.error === 'net::ERR_BLOCKED_BY_CLIENT' && blocked.push(new URL(d.url).hostname));
  const t = new ElectronPageTransport();
  const out: Record<string, unknown> = {};
  out.user = await t.user();
  say('user');
  const st = await t.send({ method: 'GET', url: urls.studyTemplates });
  out.studyTemplates = { status: st.status, standard: (JSON.parse(st.body).standard ?? []).length };
  const mc = await t.send({ method: 'GET', url: urls.chartCount });
  out.chartCount = { status: mc.status, body: mc.body.slice(0, 100) };
  const pine = await t.send({ method: 'GET', url: urls.pineList });
  out.pineList = { status: pine.status };

  const hanging = 'new Promise(() => {})';
  const started = Date.now();
  const pending = settle((t as unknown as { run(s: string): Promise<unknown> }).run(hanging));
  setTimeout(() => t.close(), 1000);
  out.closedWhileRunning = { ...(await pending), ms: Date.now() - started }
  say(`closed while running: ${JSON.stringify(out.closedWhileRunning)}`);
  const short = new ElectronPageTransport(2000);
  const t2 = Date.now();
  out.timesOut = { ...(await settle((short as unknown as { run(s: string): Promise<unknown> }).run(hanging))), ms: Date.now() - t2 };
  say(`times out: ${JSON.stringify(out.timesOut)}`);
  short.close();
  out.worksAfterClose = (await t.send({ method: 'GET', url: urls.studyTemplates })).status;
  out.blockedHosts = [...new Set(blocked)];
  say(JSON.stringify(out, null, 2));
  say('DONE');
  t.close();
  app.quit();
});
