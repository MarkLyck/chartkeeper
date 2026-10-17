/** Electron entry that checks the hidden-page transport against the real tradingview.com, signed out. Bundle with esbuild, then run with electron */
import { app } from 'electron';
import { urls } from '../src/core/tv/endpoints';
import { ElectronPageTransport, tvSession } from '../src/main/tvSession';

app.whenReady().then(async () => {
  const blocked: string[] = [];
  const s = tvSession();
  s.webRequest.onErrorOccurred((d) => d.error === 'net::ERR_BLOCKED_BY_CLIENT' && blocked.push(new URL(d.url).hostname));
  const t = new ElectronPageTransport();
  const out: Record<string, unknown> = {};
  out.user = await t.user();
  out.buildTime = await t.buildTime();
  const st = await t.send({ method: 'GET', url: urls.studyTemplates });
  out.studyTemplates = { status: st.status, standard: (JSON.parse(st.body).standard ?? []).length };
  const mc = await t.send({ method: 'GET', url: urls.chartCount });
  out.chartCount = { status: mc.status, body: mc.body.slice(0, 100) };
  const pine = await t.send({ method: 'GET', url: urls.pineList });
  out.pineList = { status: pine.status, body: pine.body.slice(0, 50) };
  await new Promise((r) => setTimeout(r, 3000));
  out.blockedHosts = [...new Set(blocked)];
  console.log(JSON.stringify(out, null, 2));
  t.close();
  app.quit();
});
