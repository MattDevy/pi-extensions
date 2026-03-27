/**
 * Instinct validation.
 * Rejects instincts with empty, undefined, or nonsense action/trigger fields.
 */

const MIN_FIELD_LENGTH = 10;
const INVALID_LITERALS = new Set(["undefined", "null", "none", ""]);

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function isInvalidField(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return `${fieldName} is ${String(value)}`;
  }
  if (typeof value !== "string") {
    return `${fieldName} is not a string (got ${typeof value})`;
  }
  const trimmed = value.trim();
  if (INVALID_LITERALS.has(trimmed.toLowerCase())) {
    return `${fieldName} is the literal string "${trimmed}"`;
  }
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return `${fieldName} is too short (${trimmed.length} chars, minimum ${MIN_FIELD_LENGTH})`;
  }
  return null;
}

/**
 * Validates that an instinct's action and trigger fields are meaningful.
 * Returns { valid: true } or { valid: false, reason: "..." }.
 */
export function validateInstinct(fields: {
  action: unknown;
  trigger: unknown;
}): ValidationResult {
  const actionError = isInvalidField(fields.action, "action");
  if (actionError) {
    return { valid: false, reason: actionError };
  }

  const triggerError = isInvalidField(fields.trigger, "trigger");
  if (triggerError) {
    return { valid: false, reason: triggerError };
  }

  return { valid: true };
}
