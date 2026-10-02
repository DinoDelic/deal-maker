import { normalize } from './parse.js';

export interface FilterHit {
  code: string;
  label: string;
}

interface Rule {
  code: string;
  label: string;
  re: RegExp;
}

/**
 * Removes negated phrases so that "keine Defekte", "nicht gesperrt", "iCloud abgemeldet",
 * "simlockfrei" or "kein Tausch" do not trigger exclusions. Removes up to three words
 * after a negation, stopping at punctuation.
 */
export function stripNegations(normalized: string): string {
  return normalized
    .replace(/\b(kein|keine|keinen|keiner|keinerlei|nicht|ohne|nie|niemals|frei von|no)\b( [^\s.,;:!?()]+){1,3}/g, ' ')
    .replace(
      /\b[\w-]*(icloud|lock|sperre)[\w-]*( ?-?)(frei|free|abgemeldet|entfernt|deaktiviert|ausgeloggt|entsperrt|clean|aus)\b/g,
      ' ',
    );
}

/** Hard exclusions (plan section 5, step 2). Checked on title + text with negations removed. */
const EXCLUDE_RULES: Rule[] = [
  { code: 'ICLOUD', label: 'iCloud-/Aktivierungssperre', re: /icloud|aktivierungssperre|activation lock|gesperrt|blacklist|\bmdm\b/ },
  { code: 'DEFECT', label: 'Defekt/Bastler', re: /bastler|defekt|kaputt|für teile|fuer teile|for parts|ersatzteil|wasserschaden/ },
  { code: 'DISPLAY_BROKEN', label: 'Display gebrochen', re: /displaybruch|display (ist )?(gebrochen|kaputt|gesprungen)|glasbruch|riss(e)? im (display|glas)/ },
  { code: 'BOX_ONLY', label: 'Nur Verpackung/Hülle', re: /nur (die |der )?(hülle|ovp|karton|verpackung|box)\b|leere (ovp|verpackung|box)|empty box/ },
  { code: 'DUMMY', label: 'Attrappe/Fälschung', re: /attrappe|dummy|\bfake\b|replica|nachbau|\b1:1\b/ },
  { code: 'LOCKED', label: 'SIM-/Netzsperre', re: /sim-?lock|net-?lock|netzsperre|provider ?lock/ },
  { code: 'RENTAL', label: 'Mietgerät/Finanzierung', re: /mietgerät|mietgeraet|finanzierung läuft|ratenzahlung offen/ },
  { code: 'TRADE', label: 'Tausch/Gesuch', re: /\btausch(e|en)?\b|\bsuche\b/ },
];

/** Checked on raw normalized text: these phrases contain a negation themselves. */
const RAW_EXCLUDE_RULES: Rule[] = [
  { code: 'FACE_ID', label: 'Face ID defekt', re: /face ?id (geht|funktioniert) nicht|ohne face ?id|face ?id (defekt|ausgefallen)/ },
  { code: 'DEFECT', label: 'Defekt/Bastler', re: /(kamera|lautsprecher|mikrofon|wlan|ladebuchse|touch|display|true ?tone) (geht|funktioniert|reagiert) nicht|(lädt|startet|bootet) nicht/ },
];

/** Accessories that only mention an iPhone ("Hülle für iPhone 15 Pro"). Title only. */
const ACCESSORY_WORDS =
  '(hülle|huelle|case|cover|panzerglas|schutzglas|schutzfolie|ladekabel|kabel|ladegerät|netzteil|magsafe|kameraschutz|ersatzakku|halterung)';
const ACCESSORY_RE = new RegExp(`\\b(für|fuer|for|kompatibel mit|passend für) (apple )?iphone|\\b${ACCESSORY_WORDS}\\b`);
/** "iPhone 15 inkl. Hülle" is a phone with extras, not an accessory. */
const EXTRAS_RE = new RegExp(`\\b(inkl\\.?|inklusive|mit|plus|\\+|und|&|,|sowie|gratis|dazu) ?(\\S+ ){0,2}${ACCESSORY_WORDS}\\b`, 'g');

/** Hints at paying outside the platform -> no buyer protection (plan section 7b). */
const OFF_PLATFORM_RE =
  /überweisung|ueberweisung|paypal (an )?freunde|freunde (und|&) familie|\bf&f\b|whatsapp|schreib(t)? mir (eine |per )?(e-?mail|mail)|kontaktier(e|t) mich (per|unter)|\bvorkasse\b/;

export function hardExclusions(title: string, text: string): FilterHit[] {
  const raw = normalize(`${title} ${text}`);
  const cleaned = stripNegations(raw);
  const hits = new Map<string, FilterHit>();
  for (const r of EXCLUDE_RULES) if (r.re.test(cleaned)) hits.set(r.code, { code: r.code, label: r.label });
  for (const r of RAW_EXCLUDE_RULES) if (r.re.test(raw)) hits.set(r.code, { code: r.code, label: r.label });
  const t = normalize(title).replace(EXTRAS_RE, ' ');
  if (ACCESSORY_RE.test(t)) hits.set('ACCESSORY', { code: 'ACCESSORY', label: 'Zubehör, kein Gerät' });
  return [...hits.values()];
}

export function offPlatformPayment(title: string, text: string): boolean {
  return OFF_PLATFORM_RE.test(stripNegations(normalize(`${title} ${text}`)));
}

/** Soft warnings that lower confidence but do not block. */
export function softWarnings(title: string, text: string): FilterHit[] {
  const all = normalize(`${title} ${text}`);
  const out: FilterHit[] = [];
  if (/display (wurde )?(getauscht|gewechselt|ersetzt)|displaytausch|neues display|drittanbieter|akku (wurde )?(getauscht|gewechselt)/.test(all)) {
    out.push({ code: 'PARTS_REPLACED', label: 'Teile getauscht (Display/Akku)' });
  }
  if (/stockfoto|symbolbild|beispielbild|bild ähnlich/.test(all)) {
    out.push({ code: 'STOCK_PHOTO', label: 'Keine eigenen Fotos' });
  }
  if (/nur abholung|nur selbstabholung|nur an selbstabholer/.test(all)) {
    out.push({ code: 'PICKUP_ONLY', label: 'Nur Abholung' });
  }
  return out;
}
