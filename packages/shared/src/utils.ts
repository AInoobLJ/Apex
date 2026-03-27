export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampProbability(value: number): number {
  return clamp(value, 0, 1);
}

export function exponentialDecay(halfLifeMinutes: number, ageMinutes: number): number {
  const lambda = Math.LN2 / halfLifeMinutes;
  return Math.exp(-lambda * ageMinutes);
}

export function weightedAverage(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
}

export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function trimmedMean(values: number[]): number {
  if (values.length <= 2) {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1);
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
}

export function queryString(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

// ── Input Validation Utilities ──

/** Check if a number is finite (not NaN, not Infinity) */
export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Check if a number is a valid probability [0, 1] */
export function isValidProbability(p: unknown): p is number {
  return isFiniteNumber(p) && p >= 0 && p <= 1;
}

/** Replace NaN/Infinity/non-number with a fallback value */
export function safeNumber(n: unknown, fallback: number): number {
  return isFiniteNumber(n) ? n : fallback;
}

/** Clamp probability to [0.01, 0.99] with NaN → 0.5 */
export function safeProbability(p: unknown): number {
  if (!isFiniteNumber(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

/** Validate that all values in a Record<string, number> are finite numbers */
export function validateWeights(weights: Record<string, unknown>): { valid: boolean; badKeys: string[] } {
  const badKeys: string[] = [];
  for (const [k, v] of Object.entries(weights)) {
    if (!isFiniteNumber(v)) badKeys.push(k);
  }
  return { valid: badKeys.length === 0, badKeys };
}

/** Strictly parse a boolean value — rejects string "true", only accepts actual boolean */
export function strictBoolean(value: unknown): boolean {
  return value === true;
}
