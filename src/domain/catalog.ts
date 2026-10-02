/**
 * iPhone catalog in scope for V1 (plan section 2): iPhone 14 to 17 incl. 16e and Air.
 * A variant = model + storage. Colour is ignored for pricing.
 */

export type ModelKey =
  | '14' | '14-plus' | '14-pro' | '14-pro-max'
  | '15' | '15-plus' | '15-pro' | '15-pro-max'
  | '16' | '16-plus' | '16-pro' | '16-pro-max' | '16e'
  | '17' | '17-pro' | '17-pro-max' | 'air';

export interface ModelInfo {
  key: ModelKey;
  name: string;
  /** Storage options in GB, ascending. */
  storagesGb: number[];
}

export const MODELS: readonly ModelInfo[] = [
  { key: '14', name: 'iPhone 14', storagesGb: [128, 256, 512] },
  { key: '14-plus', name: 'iPhone 14 Plus', storagesGb: [128, 256, 512] },
  { key: '14-pro', name: 'iPhone 14 Pro', storagesGb: [128, 256, 512, 1024] },
  { key: '14-pro-max', name: 'iPhone 14 Pro Max', storagesGb: [128, 256, 512, 1024] },
  { key: '15', name: 'iPhone 15', storagesGb: [128, 256, 512] },
  { key: '15-plus', name: 'iPhone 15 Plus', storagesGb: [128, 256, 512] },
  { key: '15-pro', name: 'iPhone 15 Pro', storagesGb: [128, 256, 512, 1024] },
  { key: '15-pro-max', name: 'iPhone 15 Pro Max', storagesGb: [256, 512, 1024] },
  { key: '16', name: 'iPhone 16', storagesGb: [128, 256, 512] },
  { key: '16-plus', name: 'iPhone 16 Plus', storagesGb: [128, 256, 512] },
  { key: '16-pro', name: 'iPhone 16 Pro', storagesGb: [128, 256, 512, 1024] },
  { key: '16-pro-max', name: 'iPhone 16 Pro Max', storagesGb: [256, 512, 1024] },
  { key: '16e', name: 'iPhone 16e', storagesGb: [128, 256, 512] },
  { key: '17', name: 'iPhone 17', storagesGb: [256, 512] },
  { key: '17-pro', name: 'iPhone 17 Pro', storagesGb: [256, 512, 1024] },
  { key: '17-pro-max', name: 'iPhone 17 Pro Max', storagesGb: [256, 512, 1024, 2048] },
  { key: 'air', name: 'iPhone Air', storagesGb: [256, 512, 1024] },
];

const BY_KEY = new Map(MODELS.map((m) => [m.key, m]));

export function getModel(key: ModelKey): ModelInfo {
  const m = BY_KEY.get(key);
  if (!m) throw new Error(`Unknown model ${key}`);
  return m;
}

export function isModelKey(value: string): value is ModelKey {
  return BY_KEY.has(value as ModelKey);
}

/**
 * Condition grades (plan section 4). Ordered best to worst.
 * PARTS (defekt) is never reported.
 */
export const GRADES = ['NEW', 'LIKE_NEW', 'GOOD', 'USED', 'PARTS'] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_LABEL: Record<Grade, string> = {
  NEW: 'Neu',
  LIKE_NEW: 'Wie neu',
  GOOD: 'Gut',
  USED: 'Gebraucht',
  PARTS: 'Defekt',
};

export function worseGrade(a: Grade, b: Grade): Grade {
  return GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b;
}

export interface Variant {
  model: ModelKey;
  storageGb: number;
}

export function variantKey(v: Variant): string {
  return `${v.model}/${v.storageGb}`;
}

export function variantName(v: Variant): string {
  const storage = v.storageGb >= 1024 ? `${v.storageGb / 1024} TB` : `${v.storageGb} GB`;
  return `${getModel(v.model).name} ${storage}`;
}
