export function normalizeString(value: unknown, fallback?: string): string {
  if (typeof value !== "string") return fallback ?? "";
  return value.trim();
}

/** Unwrap a PostgREST embed that may be typed/returned as either a single row or an array. */
export function firstOrSelf<T>(value: ReadonlyArray<T> | null | undefined): T | null;
export function firstOrSelf<T>(value: T | null | undefined): T | null;
export function firstOrSelf<T>(value: T | ReadonlyArray<T> | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
