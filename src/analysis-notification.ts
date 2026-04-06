/**
 * Extension-side notification for analysis events.
 *
 * On `before_agent_start`, consumes pending analysis events and shows
 * a brief one-line notification summarizing instinct changes since the
 * last session interaction.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  consumeAnalysisEvents,
  type AnalysisEvent,
} from "./analysis-event-log.js";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Aggregates multiple analysis events into a single summary line.
 * Returns null when no changes occurred.
 */
export function formatNotification(
  events: readonly AnalysisEvent[],
): string | null {
  if (events.length === 0) return null;

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const createdIds: string[] = [];

  for (const event of events) {
    created += event.created.length;
    updated += event.updated.length;
    deleted += event.deleted.length;
    for (const c of event.created) {
      createdIds.push(c.id);
    }
  }

  if (created === 0 && updated === 0 && deleted === 0) return null;

  const parts: string[] = [];
  if (created > 0) {
    const idList = createdIds.slice(0, 3).join(", ");
    const suffix = createdIds.length > 3 ? ", ..." : "";
    parts.push(`+${created} new (${idList}${suffix})`);
  }
  if (updated > 0) {
    parts.push(`${updated} updated`);
  }
  if (deleted > 0) {
    parts.push(`${deleted} deleted`);
  }

  return `[instincts] Background analysis: ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Checks for pending analysis events and shows a notification if any exist.
 * Safe to call on every `before_agent_start` - no-ops when there's nothing.
 */
export function checkAnalysisNotifications(
  ctx: ExtensionContext,
  projectId: string | null,
  baseDir?: string,
): void {
  if (!projectId) return;

  const events = consumeAnalysisEvents(projectId, baseDir);
  const message = formatNotification(events);

  if (message) {
    ctx.ui.notify(message, "info");
  }
}
