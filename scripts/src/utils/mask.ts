/**
 * Masks a string by keeping only the first `prefixLen` characters
 * and replacing the rest with `***`.
 *
 * Used to redact sensitive values (appSecret, appToken, tableId)
 * before logging.
 *
 * Edge cases:
 * - Empty string → returns `***`
 * - String shorter than or equal to prefixLen → returns `s + '***'`
 */
export function mask(s: string, prefixLen = 4): string {
  return s.slice(0, prefixLen) + '***';
}
