/**
 * Telegram setup helper: finds your chat id and sends a test message.
 *
 *   1. Put TELEGRAM_BOT_TOKEN into .env
 *   2. Send /start to your bot in the Telegram app
 *   3. npm run telegram:setup
 */
import { loadDotEnv, requireEnv } from './env.js';

loadDotEnv();
const token = requireEnv('TELEGRAM_BOT_TOKEN');
const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

interface Update {
  message?: { chat: { id: number; type: string; first_name?: string } };
}

const res = await fetch(api('getUpdates'));
if (!res.ok) {
  console.error(`Telegram antwortet mit ${res.status}. Ist der Token richtig kopiert?`);
  process.exit(1);
}
const { result } = (await res.json()) as { result: Update[] };
const chat = result
  .map((u) => u.message?.chat)
  .filter((c) => c?.type === 'private')
  .at(-1);

if (!chat) {
  console.error('Keine Nachricht gefunden. Schick deinem Bot in Telegram zuerst /start und starte den Befehl dann erneut.');
  process.exit(1);
}

const send = await fetch(api('sendMessage'), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: chat.id, text: '✅ Deal Scanner ist verbunden. Hier kommen deine iPhone-Deals an.' }),
});
if (!send.ok) {
  console.error(`Testnachricht fehlgeschlagen: ${send.status} ${await send.text()}`);
  process.exit(1);
}

console.log(`Gefunden: Chat von ${chat.first_name ?? 'dir'}. Testnachricht ist unterwegs.`);
console.log(`Trage diese Zeile in deine .env ein:\n\nTELEGRAM_CHAT_ID=${chat.id}\n`);
