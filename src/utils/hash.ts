import { createHash } from 'node:crypto';

/**
 * Compute the SHA-256 hash of the input string and return it as a lowercase hex string.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Return the first `len` characters of the SHA-256 hex digest of the input.
 * Used to derive compact, collision-resistant identifiers (e.g. taskHash for uniqueId).
 */
export function shortHash(input: string, len = 16): string {
  return sha256Hex(input).slice(0, len);
}
