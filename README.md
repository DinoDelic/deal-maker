# Deal Maker: iPhone-Deal-Scanner

Findet gute iPhone-Angebote auf eBay.de und meldet sie per Telegram. Er kauft nichts. Der Plan steht in `iphone-scanner-plan.md` im Projektordner.

## So funktioniert ein Durchlauf (alle 2 Minuten)
1. Über die offizielle eBay Browse API (EBAY_DE) werden die neuesten Sofort-Kaufen-/Preisvorschlag-Angebote und bald endende Auktionen in „Handys & Smartphones“ abgerufen.
2. Jedes Angebot wird einer Variante (Modell + Speicher) und einer Zustandsstufe zugeordnet. Zubehör, Defekte, iCloud-Sperre, Attrappen, Tausch und Auslandsangebote werden aussortiert (`src/domain/filters.ts`).
3. Die Bewertung (`src/domain/evaluate.ts`):
   - **Sicher-Deal**, wenn der Einstand (Preis + Versand) mindestens 20 € unter dem Ankaufpreis liegt.
   - **Guter Deal**, wenn der erwartete Gewinn mindestens 50 € und mindestens 15 % beträgt.
   - **Preisvorschlag**, wenn ein Vorschlag von höchstens 20 % unter dem Angebotspreis einen guten Deal ergibt.
4. Sicherheitsbewertung: Verkäufer-Vertrauen aus der Zahl der Bewertungen und der Positiv-Quote (`src/domain/trust.ts`), Lockpreise und Hinweise auf Zahlung außerhalb von eBay werden blockiert.
5. Bei Kandidaten wird einmal die volle Beschreibung geladen, danach wird neu bewertet und gegebenenfalls gemeldet. Jedes Angebot wird nur einmal gemeldet, ein zweites Mal nur bei Preissenkung.

Marktwerte baut der Scanner selbst auf: das untere Viertel der aktiven Angebote je Variante und Zustand sowie Auktionsstände kurz vor Ende. Ankaufpreise trägst du wöchentlich in `data/reference-prices.csv` ein.

## Einrichten
```bash
npm install
cp .env.example .env      # Zugänge eintragen, .env wird nie eingecheckt
npm test                  # Tests
npm run scan:once         # ein Durchlauf (Standard: Probebetrieb, nur Konsole und Log)
npm run scan:loop         # Dauerbetrieb alle SCAN_INTERVAL_SECONDS
```
Im Probebetrieb (`DRY_RUN=1`) landen alle Entscheidungen in `data/state/decisions.jsonl`. Erst mit `DRY_RUN=0` gehen Nachrichten an Telegram.

## Auf dem eigenen Rechner laufen lassen
1. **Node.js 22 (LTS)** installieren: https://nodejs.org (Windows/Mac-Installer, einfach durchklicken).
2. Code holen: `git clone https://github.com/<dein-name>/deal-maker.git` (oder auf GitHub „Code → Download ZIP“) und im Ordner ein Terminal öffnen.
3. `npm install`
4. `.env.example` nach `.env` kopieren und Zugänge eintragen (eBay, Telegram). Zuerst `DRY_RUN=1` lassen.
5. `npm run scan:loop` starten. Das Fenster offen lassen.
6. Energiesparen so einstellen, dass der Rechner nicht in den Ruhezustand geht, solange der Scanner laufen soll.

Später auf einen Server umziehen geht mit denselben Befehlen: Code dort holen, `.env` und den Ordner `data/` mitnehmen (darin stecken die gesammelten Marktpreise), fertig.

## Schnell-Check (Kleinanzeigen und alles andere)
```bash
npm run check -- --title "iPhone 15 Pro 256GB" --text "Akku 89 %, keine Kratzer" --price 495 --ship 6
# optional: --condition new|likenew|good|used  --ratings 120 --percent 99.5  --business
```
Es wird nichts abgerufen. Du gibst ein, was du siehst.

## Noch offen
- Ankaufpreise in `data/reference-prices.csv` eintragen
- Kategorie-ID 9355 („Handys & Smartphones“) mit dem ersten echten Abruf auf EBAY_DE prüfen
- Vorerst läuft der Scanner auf dem eigenen Rechner; bei Erfolg Umzug auf einen kleinen Server, dann PostgreSQL statt JSON-Datei und Telegram-Feedback-Buttons auswerten
- eBay-API-Lizenzbedingungen zur Speicherung von Angebotsdaten prüfen
