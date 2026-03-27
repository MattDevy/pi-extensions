/**
 * Text tokenization utilities shared by instinct-evolve generators and skill-shadow detection.
 */

/** Words excluded from text tokenization (noise words). */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "is", "are", "was", "were", "be", "been", "i", "you",
  "we", "it", "this", "that", "when", "if", "by", "as", "use",
]);

/**
 * Tokenizes a text string into significant lowercase words.
 * Strips punctuation, filters stop words, requires length >= 3.
 */
export function tokenizeText(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}
