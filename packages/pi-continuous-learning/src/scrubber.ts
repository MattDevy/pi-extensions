/** Secret scrubbing - replaces sensitive values with [REDACTED] before writing to disk */

export const REDACTED = "[REDACTED]";

/**
 * Ordered list of regex patterns that match common secret formats.
 * Full matches are replaced with REDACTED.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Authorization header value (bearer, basic, token schemes)
  /authorization\s*:\s*(?:bearer|basic|token)\s+\S+/gi,
  // Standalone bearer token (match full token value, any non-whitespace chars)
  /bearer\s+\S+/gi,
  // HTTP header shorthand: x-api-key: <value>, x-auth-token: <value>
  /x-(?:api-key|auth-token)\s*:\s*\S+/gi,
  // API key assignments: api_key=, apiKey:, api-key =, access_key=, secret_key=
  /(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key)\s*[:=]\s*\S+/gi,
  // Token assignments: token=, auth_token:, access_token=, refresh_token=
  /(?:auth[_-]?token|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+/gi,
  // Password assignments: password=, passwd:, pwd =
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
  // Secret / credential / private_key assignments
  /(?:secret|credential|private[_-]?key)\s*[:=]\s*\S+/gi,
  // AWS Access Key IDs (AKIA...)
  /AKIA[0-9A-Z]{16}/g,
  // OpenAI / Anthropic SDK keys: sk-..., sk-ant-...
  /sk-(?:ant-api03-)?[a-zA-Z0-9]{32,}/g,
];

/**
 * Scrub secrets from arbitrary text.
 * Replaces all matched secret patterns with [REDACTED].
 * Non-secret text is returned unchanged.
 */
export function scrubSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}
