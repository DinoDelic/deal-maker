import { getModel, worseGrade, type Grade, type ModelKey, type Variant } from './catalog.js';

export interface ParsedListing {
  variant: Variant | null;
  /** Why no variant could be determined. */
  rejectReason?: string;
  storageAssumed: boolean;
  grade: Grade;
  batteryPercent: number | null;
  noBox: boolean;
}

/** Lowercase, unify spellings like "15pro", "promax", "i phone", "1 tb". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ \s]+/g, ' ')
    .replace(/i\s?phone/g, 'iphone')
    .replace(/iphone(\d)/g, 'iphone $1')
    .replace(/(\d{2})(e)\b/g, '$1 e')
    .replace(/(\d{2})(pro|plus|max)/g, '$1 $2')
    .replace(/pro\s?max/g, 'pro max')
    .replace(/(\d)\s?(gb|tb)\b/g, '$1 $2');
}

const MODEL_RE = /iphone (1[0-9]) ?(e|pro max|pro|plus|max|mini)?\b|iphone air\b/g;

function toModelKey(gen: string, suffix: string | undefined): ModelKey | null {
  const key = suffix
    ? suffix === 'e'
      ? `${gen}e`
      : `${gen}-${suffix.replace(' ', '-')}`
    : gen;
  const known: string[] = [
    '14', '14-plus', '14-pro', '14-pro-max', '15', '15-plus', '15-pro', '15-pro-max',
    '16', '16-plus', '16-pro', '16-pro-max', '16e', '17', '17-pro', '17-pro-max',
  ];
  return known.includes(key) ? (key as ModelKey) : null;
}

/**
 * Finds the iPhone model in a title. Returns null when no in-scope model is found
 * or when the title names several different models (contradiction, e.g. "14 wie 15").
 */
export function parseModel(title: string): { model: ModelKey | null; reason?: string } {
  const t = normalize(title);
  const found = new Set<string>();
  for (const m of t.matchAll(MODEL_RE)) {
    if (m[0] === 'iphone air') found.add('air');
    else found.add(`${m[1]}|${m[2] ?? ''}`);
  }
  if (found.size === 0) return { model: null, reason: 'kein iPhone-Modell erkannt' };
  if (found.size > 1) return { model: null, reason: 'mehrere Modelle im Titel' };
  const [only] = [...found];
  if (only === 'air') return { model: 'air' };
  const [gen, suffix] = only!.split('|');
  const model = toModelKey(gen!, suffix || undefined);
  return model ? { model } : { model: null, reason: 'Modell nicht im Fokus' };
}

export function parseStorages(text: string): number[] {
  const t = normalize(text);
  const out = new Set<number>();
  for (const m of t.matchAll(/\b(64|128|256|512|1|2) (gb|tb)\b/g)) {
    const n = Number(m[1]);
    if (m[2] === 'tb' && (n === 1 || n === 2)) out.add(n * 1024);
    if (m[2] === 'gb' && n >= 64) out.add(n);
  }
  return [...out];
}

export function parseBattery(text: string): number | null {
  const t = normalize(text);
  const patterns = [
    /(?:akku|batterie|battery)[a-zäöüß ]{0,20}?[:\-]? ?(\d{2,3}) ?%/,
    /(\d{2,3}) ?% ?(?:akku|batterie|battery|bh)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 50 && n <= 100) return n;
    }
  }
  return null;
}

/** Grade from marketplace condition id (eBay ids). Unknown -> USED (conservative). */
export function gradeFromConditionId(id: number | null): Grade {
  switch (id) {
    case 1000:
    case 1500:
      return 'NEW';
    case 2000:
    case 2010:
      return 'LIKE_NEW';
    case 2020:
    case 2500:
      return 'GOOD';
    case 7000:
      return 'PARTS';
    default:
      return 'USED';
  }
}

/** For plain "used" listings the text may refine the grade; it can never upgrade NEW-type ids. */
export function gradeFromText(text: string): Grade | null {
  const t = normalize(text);
  if (/wie neu|neuwertig|makellos/.test(t)) return 'LIKE_NEW';
  if (/sehr gut|guter zustand|gepflegt|keine kratzer|kratzerfrei|top zustand/.test(t)) return 'GOOD';
  return null;
}

export function parseListing(input: {
  title: string;
  text: string;
  conditionId: number | null;
  aspects: Record<string, string>;
}): ParsedListing {
  const { model, reason } = parseModel(input.title);
  const all = `${input.title} ${input.text}`;
  let grade = gradeFromConditionId(input.conditionId);
  if (input.conditionId === 3000 || input.conditionId === null) {
    grade = gradeFromText(all) ?? 'USED';
  }
  const textGrade = gradeFromText(all);
  if (grade === 'NEW' && textGrade) grade = worseGrade(grade, textGrade);

  const batteryPercent = parseBattery(all);
  const noBox = /(ohne|keine|kein) (ovp|originalverpackung|karton|verpackung)/.test(normalize(all));

  if (!model) {
    return { variant: null, rejectReason: reason, storageAssumed: false, grade, batteryPercent, noBox };
  }

  const info = getModel(model);
  const aspectStorage = Object.entries(input.aspects).find(([k]) =>
    /speicher|storage capacity/i.test(k),
  )?.[1];
  const titleStorages = parseStorages(input.title).filter((s) => info.storagesGb.includes(s));
  const aspectStorages = aspectStorage
    ? parseStorages(aspectStorage).filter((s) => info.storagesGb.includes(s))
    : [];
  const candidates = [...new Set([...titleStorages, ...aspectStorages])];

  if (candidates.length > 1) {
    return {
      variant: null,
      rejectReason: 'mehrere Speichergrößen genannt',
      storageAssumed: false,
      grade,
      batteryPercent,
      noBox,
    };
  }
  const storageAssumed = candidates.length === 0;
  // Unknown storage: assume the smallest option (conservative valuation).
  const storageGb = candidates[0] ?? info.storagesGb[0]!;
  return { variant: { model, storageGb }, storageAssumed, grade, batteryPercent, noBox };
}
