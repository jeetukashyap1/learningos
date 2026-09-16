/**
 * Shared text utilities for the YouTube layer.
 *
 * Tokenization is intentionally simple and deterministic: lowercase, split on
 * anything that is not a letter, digit, "+", "#", or ".", then drop stopwords
 * and single characters. The same function is used for scoring and for cache
 * keys, so identical inputs always produce identical tokens.
 */

const TOKEN_SPLIT_PATTERN = /[^a-z0-9+#.]+/;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "with", "using", "how",
  "what", "why", "is", "are", "do", "does", "your", "you", "it", "its", "at", "by",
  "from", "this", "that", "be", "can", "will", "vs", "into", "about",
]);

/** Splits text into normalized, significant tokens (e.g. "Async/Await" -> ["async", "await"]). */
export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(TOKEN_SPLIT_PATTERN)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}
