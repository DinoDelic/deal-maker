/**
 * Local dashboard: http://localhost:3000
 *
 *   npm run dashboard            # shows what the scanner logged (data/state)
 *   npm run dashboard -- --demo  # fictional demo data, to look around before the first scan
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildDemo } from '../dashboard/demo.js';
import { renderPage, type View } from '../dashboard/page.js';
import { parseLog, summarize } from '../dashboard/summary.js';
import { JsonFileStore } from '../store.js';
import { loadDotEnv } from './env.js';

loadDotEnv();
const demo = process.argv.includes('--demo');
const port = Number(process.env.DASHBOARD_PORT ?? 3000);
const stateDir = demo ? 'data/demo' : (process.env.STATE_DIR ?? 'data/state');
const dryRun = process.env.DRY_RUN !== '0';

if (demo) {
  console.log('Erzeuge Beispieldaten ...');
  await buildDemo(stateDir);
}

const VIEWS: View[] = ['deals', 'blocked', 'market'];

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }
  const view = VIEWS.find((v) => v === url.searchParams.get('view')) ?? 'deals';
  const logPath = `${stateDir}/decisions.jsonl`;
  const entries = existsSync(logPath) ? parseLog(readFileSync(logPath, 'utf8')) : [];
  const store = new JsonFileStore(`${stateDir}/state.json`);
  const html = renderPage(summarize(entries, store, new Date()), { view, dryRun, demo });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
}).listen(port, '127.0.0.1', () => {
  console.log(`Dashboard läuft: http://localhost:${port}  (beenden mit Strg+C)`);
});
