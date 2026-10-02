import { EbayBrowseAdapter } from '../adapters/ebay/client.js';
import { DEFAULT_CONFIG } from '../config.js';
import { ConsoleNotifier, TelegramNotifier, type Notifier } from '../notify/telegram.js';
import { loadReferenceCsv, referenceLookup } from '../reference.js';
import { Scanner } from '../scanner.js';
import { JsonFileStore } from '../store.js';
import { loadDotEnv, requireEnv } from './env.js';

loadDotEnv();

const loop = process.argv.includes('--loop');
const dryRun = process.env.DRY_RUN !== '0';
const intervalMs = Number(process.env.SCAN_INTERVAL_SECONDS ?? 120) * 1000;
const stateDir = process.env.STATE_DIR ?? 'data/state';

const adapter = new EbayBrowseAdapter({ appId: requireEnv('EBAY_APP_ID'), certId: requireEnv('EBAY_CERT_ID') });
const store = new JsonFileStore(`${stateDir}/state.json`, `${stateDir}/decisions.jsonl`);
const refs = referenceLookup(loadReferenceCsv(process.env.REFERENCE_CSV ?? 'data/reference-prices.csv'), store);
const notifier: Notifier = dryRun
  ? new ConsoleNotifier()
  : new TelegramNotifier(requireEnv('TELEGRAM_BOT_TOKEN'), requireEnv('TELEGRAM_CHAT_ID'));

const scanner = new Scanner({
  adapter,
  refs,
  store,
  notifier,
  config: DEFAULT_CONFIG,
  maxDetailsPerCycle: Number(process.env.MAX_DETAILS_PER_CYCLE ?? 3),
});

async function once(): Promise<void> {
  const started = Date.now();
  try {
    const s = await scanner.runCycle();
    console.log(
      `${new Date().toISOString()} ${dryRun ? '[Probebetrieb] ' : ''}` +
        `${s.fetched} Angebote, ${s.alerts} Alarme, ${s.detailCalls} Detailabrufe, ` +
        `eBay-Aufrufe gesamt ${adapter.calls}, Stufen ${JSON.stringify(s.byTier)} (${Date.now() - started} ms)`,
    );
  } catch (err) {
    console.error(`${new Date().toISOString()} Scan fehlgeschlagen: ${(err as Error).message}`);
  }
}

await once();
if (loop) setInterval(once, intervalMs);
