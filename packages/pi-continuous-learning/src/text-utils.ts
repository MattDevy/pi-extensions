function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

/**
 * Replaces relative date references in evidence strings with absolute ISO dates
 * so they remain meaningful after the session that created them.
 *
 * Applied only at write time — existing evidence is left untouched.
 */
export function normalizeRelativeDates(text: string, now = new Date()): string {
  return text
    .replace(/\btoday\b/gi, formatDate(now))
    .replace(/\bthis morning\b/gi, formatDate(now))
    .replace(/\byesterday\b/gi, formatDate(subDays(now, 1)))
    .replace(/\blast week\b/gi, `week of ${formatDate(subDays(now, 7))}`)
    .replace(/\b(\d+) days? ago\b/gi, (_, n: string) =>
      formatDate(subDays(now, parseInt(n, 10))),
    );
}
