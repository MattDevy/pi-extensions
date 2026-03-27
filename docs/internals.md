# Internals

How pi-continuous-learning works under the hood. Covers the data flow, file layout, configuration, and module responsibilities.

---

## Architecture Overview

The system has two separate runtimes:

1. **Pi Extension** (runs inside Pi sessions): Observes events, records observations, injects instincts into prompts, registers LLM tools, and provides slash commands.
2. **Standalone Analyzer** (`src/cli/analyze.ts`): Runs outside Pi via cron/launchd. Iterates all projects, analyzes observations using Haiku + the Pi SDK, and writes instinct files.

---

## Storage Layout

All data lives under `~/.pi/continuous-learning/`. The extension creates this structure on first `session_start` via `ensureStorageLayout()` in `storage.ts`.

```
~/.pi/continuous-learning/
  config.json                          # User config overrides (optional)
  projects.json                        # Registry mapping project hash -> metadata
  analyze.lock                         # Lockfile (present only while analyzer runs)
  instincts/
    personal/                          # Global instincts (user-created)
      prefer-grep-before-edit.md
    inherited/                         # Imported global instincts
  projects/
    <12-char-hash>/
      project.json                     # Project metadata + last_analyzed_at
      observations.jsonl               # Current observation log (append-only)
      observations.archive/            # Rotated observation files
        2026-03-15T10-30-00-000Z.jsonl
      instincts/
        personal/                      # Project-scoped instincts
          use-result-type.md
        inherited/                     # Imported project instincts
```

### Key paths (from `storage.ts`)

| Function | Returns |
|---|---|
| `getBaseDir()` | `~/.pi/continuous-learning/` |
| `getProjectDir(id)` | `~/.pi/continuous-learning/projects/<id>/` |
| `getObservationsPath(id)` | `.../<id>/observations.jsonl` |
| `getArchiveDir(id)` | `.../<id>/observations.archive/` |
| `getProjectInstinctsDir(id, "personal")` | `.../<id>/instincts/personal/` |
| `getGlobalInstinctsDir("personal")` | `~/.pi/continuous-learning/instincts/personal/` |
| `getProjectsRegistryPath()` | `~/.pi/continuous-learning/projects.json` |

### Files written

| File | Written by | Format | When |
|---|---|---|---|
| `config.json` | User (manual) | JSON | User creates/edits manually |
| `projects.json` | `ensureStorageLayout()` | JSON | Every `session_start` |
| `project.json` | `ensureStorageLayout()` / analyzer | JSON | First time a project is seen; updated with `last_analyzed_at`, `last_observation_line_count`, `agents_md_project_hash`, and `agents_md_global_hash` by analyzer |
| `observations.jsonl` | `appendObservation()` | JSONL (one JSON object per line) | Every tool call, prompt, and agent end |
| `*.jsonl` in archive | `appendObservation()` | JSONL | When `observations.jsonl` hits 10 MB |
| `<id>.md` in instincts dirs | Standalone analyzer (via `instinct_write` tool) | YAML frontmatter + Markdown | Every analysis run |
| `analyze.lock` | Standalone analyzer | JSON (`{pid, started_at}`) | While analyzer is running |
| `analysis-events.jsonl` | Standalone analyzer | JSONL (one summary per run) | After each project analysis with changes |
| `analysis-events.consumed` | Extension (transient) | JSONL | Briefly during atomic consume; deleted after read |

---

## Configuration

Defined in `config.ts`. The extension reads `~/.pi/continuous-learning/config.json` once on `session_start` and caches the result for the session. If the file is missing or malformed, defaults are used.

### Default values

```typescript
{
  run_interval_minutes: 5,                // Suggested cron interval
  min_observations_to_analyze: 20,        // Minimum observations before analysis triggers
  min_confidence: 0.5,                    // Instincts below this are not injected
  max_instincts: 20,                      // Cap on instincts injected per turn
  model: "claude-haiku-4-5",              // Model for the analyzer
  timeout_seconds: 120,                   // Per-project timeout for analyzer LLM session
  active_hours_start: 8,                  // (legacy, unused by standalone analyzer)
  active_hours_end: 23,                   // (legacy, unused by standalone analyzer)
  max_idle_seconds: 1800,                 // (legacy, unused by standalone analyzer)
  // Volume control
  max_total_instincts_per_project: 30,    // Hard cap per project (auto-deletes lowest-confidence)
  max_total_instincts_global: 20,         // Hard cap for global instincts (auto-deletes lowest-confidence)
  max_new_instincts_per_run: 3,           // Max new instincts created by the analyzer per run
  flagged_cleanup_days: 7,               // Auto-delete flagged_for_removal instincts after N days
  instinct_ttl_days: 28,                 // Auto-delete zero-confirmation instincts after N days
  // Consolidation (dream)
  dreaming_enabled: true,                 // Whether automatic consolidation runs during normal analysis
  consolidation_interval_days: 7,         // Minimum days between consolidation runs
  consolidation_min_sessions: 10,         // Minimum sessions since last consolidation
}
```

### Partial overrides

The config file only needs to contain fields you want to change. TypeBox `Value.Clean` strips unknown keys, then the partial is merged over defaults.

---

## Project Detection

`project.ts` identifies the current project so observations and instincts are scoped correctly. Resolution order:

1. Run `git remote get-url origin` in `ctx.cwd` — if it succeeds, SHA-256 hash the remote URL and take the first 12 hex characters as the project ID.
2. Fallback: run `git rev-parse --show-toplevel` and hash the repo root path instead.
3. Final fallback: use the literal string `"global"` as the project ID.

The 12-character hash means the same repo produces the same ID across machines (as long as the remote URL matches), which makes instincts portable.

---

## Data Flow

### 1. Observation Collection (Pi Extension)

```
Pi event (tool_execution_start, tool_execution_end, before_agent_start, agent_end)
  |
  v
observer-guard.ts  -- skip if path is inside ~/.pi/continuous-learning/
  |
  v
scrubber.ts        -- regex-replace secrets (API keys, tokens, passwords) with [REDACTED]
  |
  v
tool-observer.ts / prompt-observer.ts  -- build Observation object, attach active_instincts
  |
  v
observations.ts    -- appendFileSync to observations.jsonl, rotate at 10 MB
```

**Self-observation prevention** (`observer-guard.ts`): Any tool call whose file path falls under `~/.pi/continuous-learning/` is skipped.

**Secret scrubbing** (`scrubber.ts`): Nine regex patterns match common secret formats — Authorization headers, Bearer tokens, API keys, access tokens, passwords, AWS access key IDs (`AKIA...`), and Anthropic API keys (`sk-ant-...`). All matches are replaced with `[REDACTED]` before the observation is written to disk.

**Truncation**: Tool inputs are capped at 5,000 characters, tool outputs at 5,000 characters. Truncation happens after scrubbing.

**Active instincts tagging**: Every observation includes an `active_instincts` field (when non-empty) listing the IDs of instincts injected into the system prompt for the current turn. This is the bridge for the feedback loop.

### 2. Background Analysis (Standalone Script)

```
cron/launchd fires src/cli/analyze.ts
  |
  v
Acquire lockfile (analyze.lock) -- exit if another instance is running
  |
  v
Start global timeout (5 minutes)
  |
  v
For each project in projects.json:
  |
  ├── Check if observations.jsonl modified since last_analyzed_at -- skip if not
  ├── Check observation count >= min_observations_to_analyze      -- skip if not
  |
  v
instinct-cleanup.ts -- auto-cleanup: delete flagged/TTL/over-cap instincts
  |
  v
instinct-decay.ts  -- apply passive confidence decay (-0.05/week) after cleanup
  |
  v
Create AgentSession (Pi SDK) with:
  - model: claude-haiku-4-5 (configurable)
  - customTools: instinct_list, instinct_read, instinct_write, instinct_delete
  - systemPrompt: analyzer instructions (pattern detection, scoring rules, conservativeness)
  - sessionManager: in-memory (no persistence)
  |
  v
session.prompt(userPrompt)  -- sends observations + project context to Haiku
  |
  v
Haiku analyzes patterns, calls instinct_write/instinct_read tools
  |
  v
session.dispose(), update last_analyzed_at in project.json
  |
  v
appendAnalysisEvent()  -- write summary to analysis-events.jsonl for extension notification
  |
  v
Release lockfile
```

**Lockfile guard** (`analyze.lock`): A JSON file containing `{pid, started_at}`. Before starting, the script checks if the lock exists. If the owning PID is still alive and the lock is < 10 minutes old, the script exits with code 0. If the PID is dead or the lock is stale, it's treated as orphaned and overridden.

**Global timeout**: The process exits with code 2 after 5 minutes regardless of progress.

**Auto-cleanup** (`instinct-cleanup.ts`): Before decay, `runCleanupPass()` enforces four rules: (1) deletes `flagged_for_removal` instincts whose `updated_at` is older than `flagged_cleanup_days`; (2) deletes instincts with `confirmed_count === 0` older than `instinct_ttl_days`; (3) detects contradictory instincts (similar triggers with opposing actions) and flags the lower-confidence one for removal (or both when confidence is equal); (4) deletes the lowest-confidence instincts when the total count exceeds `max_total_instincts_per_project` or `max_total_instincts_global`.

**Passive decay** (`instinct-decay.ts`): After cleanup, `runDecayPass()` walks all remaining personal instinct files (project + global), applies -0.05 per week since `updated_at`, and saves any that changed by more than 0.001 confidence. Instincts that drop below 0.1 get `flagged_for_removal: true`.

### 3. System Prompt Injection (Pi Extension)

```
before_agent_start event
  |
  v
instinct-loader.ts  -- load project instincts + global instincts from disk
  |
  v
instinct-loader.ts  -- filter: confidence >= min_confidence, not flagged_for_removal
  |                     sort: confidence descending
  |                     cap: take top max_instincts
  v
instinct-injector.ts -- append injection block to systemPrompt
  |
  v
active-instincts.ts  -- store injected IDs in module-level state for observer to read
```

**Injection format** appended to the system prompt:

```
## Learned Behaviors (Instincts)

- [0.85] When modifying code: Search with grep, confirm with read, then edit
- [0.70] When writing React components: Use functional components with hooks
- [0.50] When handling errors: Use Result type pattern
```

**Feedback bridge** (`active-instincts.ts`): A simple module-level `string[]` that the injector writes and the observer reads. Set on `before_agent_start`, cleared on `agent_end`.

### 4. Analyzer Prompts

**System prompt** (`prompts/analyzer-system-single-shot.ts`): Contains pattern detection heuristics, feedback analysis instructions, confidence scoring rules, scope decision guide, conservativeness rules, and quality tier guidance. The quality tier section instructs the model to distinguish between:
- **Tier 1 - Project Conventions**: Record as project-scoped instincts
- **Tier 2 - Workflow Patterns**: Record as global-scoped instincts
- **Tier 3 - Generic Agent Behavior**: Skip - these belong in AGENTS.md, not instincts

The prompt includes negative examples ("Do NOT create instincts for read-before-edit, clarify-before-implement") and instructs the model to skip patterns already covered by AGENTS.md.

**User prompt** (`prompts/analyzer-user-single-shot.ts`): Built fresh each run. Contains project context, all existing instincts in compact JSON format, filtered observations, AGENTS.md content (project + global, only when changed), and explicit dedup instructions to skip AGENTS.md-covered patterns.

---

## Instinct Quality Validation

All instinct writes go through `validateInstinct()` in `instinct-validator.ts` before being persisted.

### Validation Rules (rejection)

| Rule | Details |
|---|---|
| Non-empty fields | `action` and `trigger` must not be `undefined`, `null`, `"undefined"`, `"null"`, `"none"`, or empty |
| Minimum length | Both fields must be at least 10 characters (after trimming) |
| Type check | Both fields must be strings |
| Known domain | `domain`, if provided, must be in the known set (see `KNOWN_DOMAINS` in `instinct-validator.ts`). Use `"other"` as an escape hatch for patterns that don't fit. |

### Validation Rules (warnings)

| Rule | Details |
|---|---|
| Verb heuristic | `action` should start with an imperative verb from `KNOWN_VERBS`. A warning is returned but the instinct is not rejected. |

### Semantic Deduplication

Before a new instinct is persisted (via `instinct_write` tool or the analyzer), a Jaccard similarity check runs against all existing instincts.

**Algorithm** (`findSimilarInstinct()` in `instinct-validator.ts`):
1. Tokenize `trigger + action` for the candidate and each existing instinct (lowercase, strip stop words, deduplicate)
2. Compute Jaccard similarity: `|intersection| / |union|`
3. If any existing instinct scores >= 0.6, the write is blocked - the caller is told to update the existing instinct instead

This prevents near-duplicate instincts from accumulating when patterns are detected multiple times with slightly different wording (e.g., "read-before-edit" and "verify-edit-context").

The `skipId` parameter allows the similarity check to ignore the instinct being updated (self-updates are always allowed).

### Contradiction Detection

While deduplication catches near-identical instincts, contradiction detection (`instinct-contradiction.ts`) catches instincts with similar triggers but *semantically opposing* actions. For example:

- "When designing APIs" -> "Prefer interfaces for dependency injection"
- "When designing APIs" -> "Avoid interfaces, prefer concrete types"

**Algorithm** (`findContradictions()` in `instinct-contradiction.ts`):
1. Filter out already-flagged instincts
2. Pre-compute trigger tokens for all active instincts
3. For each unique pair, check trigger similarity (Jaccard >= 0.4 threshold)
4. For pairs with similar triggers, check action opposition via two heuristics:
   - **Verb pair matching**: Detects opposing verbs across the two actions (e.g., "prefer" vs "avoid", "always" vs "never", "use" vs "avoid"). See `OPPOSING_VERB_PAIRS` for the full list.
   - **Negation pattern matching**: Detects "do not X" / "don't X" in one action where X appears affirmatively in the other.

**Resolution** (`cleanupContradictions()` in `instinct-cleanup.ts`):
- The lower-confidence instinct is flagged with `flagged_for_removal: true`
- When both have equal confidence, both are flagged for user review
- Flagged instincts remain visible in `/instinct-status` until the flagged cleanup window expires

This is a lightweight, zero-cost approach (no LLM calls). It runs as part of the cleanup pipeline before cap enforcement.

### LLM-Assisted Contradiction Resolution

In addition to the deterministic heuristic, contradiction awareness is built into two LLM-powered flows:

1. **Analyzer system prompt** (`prompts/analyzer-system-single-shot.ts`): Instructs the model to check for contradictions before creating new instincts, and to resolve existing contradictions by deleting the weaker instinct or merging both into a nuanced context-dependent one.

2. **`/instinct-evolve` prompt** (`prompts/evolve-prompt.ts`): Contradiction detection is the first analysis task. The LLM can catch semantic contradictions that the verb-pair heuristic misses (e.g., "write comprehensive tests" vs "keep tests minimal and fast") and offer to resolve them interactively via the instinct tools.

The deterministic pass catches obvious keyword-level contradictions at zero cost on every cleanup run. The LLM passes catch deeper semantic contradictions during analyzer runs and user-initiated evolve sessions.

---

## Instinct File Format

Instincts are stored as individual Markdown files with YAML frontmatter. Parsed/serialized by `instinct-parser.ts`.

```yaml
---
id: prefer-grep-before-edit
title: Prefer Grep Before Edit
trigger: "When modifying code in an unfamiliar file"
confidence: 0.72
domain: workflow
source: personal
scope: project
project_id: a1b2c3d4e5f6
project_name: my-app
created_at: "2026-03-01T10:00:00.000Z"
updated_at: "2026-03-25T14:30:00.000Z"
observation_count: 7
confirmed_count: 4
contradicted_count: 1
inactive_count: 12
evidence:
  - "Observed grep-then-edit pattern in 7 tool sequences"
---

Search for the relevant symbol or string with grep before opening a file for editing.
Confirm the match with read, then apply the edit.
```

**ID validation**: Must be kebab-case (`/^[a-z0-9]+(-[a-z0-9]+)*$/`). Path traversal characters are rejected.

**Confidence clamping**: Always [0.1, 0.9].

---

## Confidence Scoring

Pure functions in `confidence.ts`. No I/O.

### Initial confidence (new instincts)

| Observations | Confidence |
|---|---|
| 1-2 | 0.30 |
| 3-5 | 0.50 |
| 6-10 | 0.70 |
| 11+ | 0.85 |

### Feedback adjustments (existing instincts)

Confirmations use **diminishing returns** to prevent high-volume, easy-to-confirm instincts
from reaching maximum confidence prematurely. The delta is based on `confirmed_count` at
the time of the confirmation:

| Outcome | Condition | Delta |
|---|---|---|
| Confirmed | confirmed_count 0-3 (1st-3rd confirmation) | +0.05 |
| Confirmed | confirmed_count 4-6 (4th-6th confirmation) | +0.03 |
| Confirmed | confirmed_count 7+ (7th+ confirmation) | +0.01 |
| Contradicted | - | -0.15 |
| Inactive | - | 0 |

**Per-session deduplication**: An instinct may only be confirmed once per unique session_id.
The `last_confirmed_session` field on each instinct tracks the session that last provided a
confirmation. If the current analysis window only contains activity from that same session,
`confirmed_count` is not incremented. This prevents the same session from providing
multiple confirmation credits to the same instinct.

**Baseline behavior filtering**: The analyzer prompt instructs the model not to mark generic
agent behaviors (e.g., "read before edit", "run linter after change") as confirmed, since those
would happen regardless of the instinct. Only behaviors that are non-obvious or project-specific
should be counted as confirmed.

The `adjustConfidence(current, outcome, confirmedCount)` function in `confidence.ts` computes
the delta for a single adjustment. Client-side enforcement in `buildInstinctFromChange()` applies
the diminishing returns and session deduplication independently of the LLM's arithmetic.

### Passive decay

-0.05 per week since `updated_at`. Applied by `runDecayPass()` after cleanup, before each analysis run. At 0.5 confidence, an instinct reaches the removal threshold in ~8 weeks.

### Clamping and removal

All values clamped to [0.1, 0.9]. If the pre-clamp value drops below 0.1, `flagged_for_removal` is set to `true`. Flagged instincts are excluded from injection. They are automatically deleted after `flagged_cleanup_days` (default: 7) by the cleanup pass — users can review them before that window via `/instinct-status`.

---

## Observation File Management

`observations.ts` handles the JSONL append log.

- **Write**: `appendFileSync` — one JSON line per observation. No buffering.
- **Rotation**: When the file reaches 10 MB, it's renamed to `observations.archive/<ISO-timestamp>.jsonl` before the next write.
- **Cleanup**: On `session_start`, `cleanOldArchives()` deletes archived files with `mtime` older than 30 days.

---

## Logging

`error-logger.ts` writes structured entries to `projects/<id>/analyzer.log` at three levels: Info, Warning, and Error with timestamps and stack traces. The logger itself never throws.

---

## Module Dependency Graph

### Pi Extension (`src/index.ts`)

```
index.ts (entry point)
  |-- config.ts              -- load config from disk
  |-- project.ts             -- detect project via git
  |-- storage.ts             -- directory layout + projects registry
  |-- observations.ts        -- JSONL append + archive + cleanup + count
  |-- tool-observer.ts       -- tool_execution_start/end handlers
  |-- prompt-observer.ts     -- before_agent_start/agent_end observation handlers
  |-- instinct-injector.ts   -- before_agent_start injection + agent_end cleanup
  |   |-- instinct-loader.ts -- load + filter + sort instincts
  |   |   |-- instinct-store.ts   -- CRUD for instinct files
  |   |   |   |-- instinct-parser.ts  -- YAML frontmatter parse/serialize
  |   |-- active-instincts.ts     -- shared state: current injected IDs
  |-- instinct-tools.ts      -- pi.registerTool() definitions (list/read/write/delete/merge)
  |-- observer-guard.ts      -- self-observation prevention (path-based)
  |-- scrubber.ts            -- secret redaction
  |-- error-logger.ts        -- append to analyzer.log
  |-- instinct-status.ts     -- /instinct-status command
  |-- instinct-export.ts     -- /instinct-export command
  |-- instinct-import.ts     -- /instinct-import command
  |-- instinct-promote.ts    -- /instinct-promote command
  |-- instinct-evolve.ts     -- /instinct-evolve command (LLM-powered via pi.sendUserMessage)
  |   |-- prompts/evolve-prompt.ts  -- builds evolve analysis prompt
  |-- instinct-graduate.ts   -- /instinct-graduate command (graduation pipeline)
  |   |-- graduation.ts            -- pure graduation logic (maturity, TTL, candidates)
  |   |-- skill-scaffold.ts        -- generates SKILL.md from domain clusters
  |   |-- command-scaffold.ts      -- generates command scaffolds from workflow clusters
  |   |-- agents-md.ts             -- reads and writes AGENTS.md files
  |-- instinct-projects.ts   -- /instinct-projects command
  |-- analysis-notification.ts -- before_agent_start notification check
  |   |-- analysis-event-log.ts    -- read + consume analysis events
```

### Standalone Analyzer (`src/cli/analyze.ts`)

```
cli/analyze.ts (entry point, run via cron)
  |-- config.ts                          -- load config
  |-- storage.ts                         -- path helpers
  |-- observations.ts                    -- countObservations
  |-- observation-signal.ts              -- low-signal batch scoring + early exit
  |-- instinct-cleanup.ts                -- auto-cleanup rules (flagged, TTL, cap enforcement)
  |-- instinct-decay.ts                  -- passive confidence decay
  |   |-- confidence.ts                  -- pure confidence math
  |-- instinct-store.ts                  -- CRUD for instinct files
  |-- agents-md.ts                       -- AGENTS.md reader
  |-- analysis-event-log.ts              -- append analysis events for extension notification
  |-- cli/analyze-single-shot.ts         -- single-shot core: parseChanges, buildInstinctFromChange,
  |                                         formatInstinctsCompact, estimateTokens
  |-- prompts/analyzer-system-single-shot.ts  -- system prompt
  |-- prompts/analyzer-user-single-shot.ts    -- user prompt builder (compact instinct format)
  |-- cli/analyze-logger.ts              -- structured JSON logger
```

---

## Analyzer Cost Optimizations

The single-shot analyzer applies several strategies to reduce prompt token usage:

### 1. Compact Instinct Format

`formatInstinctsCompact()` in `cli/analyze-single-shot.ts` serializes instincts as a compact JSON array instead of full YAML frontmatter + markdown body. Each entry contains only the fields the model needs: `{id, trigger, action, confidence, domain, scope, confirmed, contradicted, inactive, age_days, last_confirmed_session?}`. The `last_confirmed_session` field is included only when set, so the analyzer can enforce per-session confirmation deduplication.

This reduces instinct context by ~70% vs. the legacy `formatInstinctsForPrompt()` (which is still exported but marked deprecated). The user prompt builder uses compact format by default.

### 2. AGENTS.md Content Caching

Before including AGENTS.md in the prompt, the analyzer computes a SHA-256 hash of the file content and compares it against `agents_md_project_hash` / `agents_md_global_hash` stored in `project.json`. If the hash is unchanged since the last run, the file is omitted (passed as `null` to the prompt builder). The hash is updated in `project.json` only after content has been successfully sent.

This means AGENTS.md (which changes rarely) is only included when it actually changes.

### 3. Prompt Token Budget

`estimateTokens(text)` uses a `chars / 4` heuristic. Before calling the model, the analyzer estimates total prompt tokens (system + user). If the estimate exceeds `PROMPT_TOKEN_BUDGET` (40,000 tokens), it applies fallbacks in order:

1. **Truncate AGENTS.md** to section headers only (`truncateAgentsMdToHeaders()`).
2. **Reduce observation lines** by halving repeatedly until the estimate fits.

A warning is logged when budget enforcement triggers.

### 4. Low-Signal Early Exit

`observation-signal.ts` scores each batch before analysis runs:

| Signal event | Points |
|---|---|
| Error observation (`is_error: true`) | +2 |
| `user_prompt` immediately after an error (correction) | +3 |
| Any other `user_prompt` | +1 |

If the total score is below `LOW_SIGNAL_THRESHOLD` (3), analysis is skipped entirely with a log entry of `"low-signal batch"`. This avoids burning tokens on batches containing only routine successful tool calls.

---

## Slash Commands

All registered in `index.ts` via `pi.registerCommand()`.

| Command | Handler | What it does |
|---|---|---|
| `/instinct-status` | `instinct-status.ts` | List all instincts grouped by domain with confidence, feedback counts, trend arrows |
| `/instinct-export` | `instinct-export.ts` | Export instincts to a JSON file (filterable by scope/domain) |
| `/instinct-import <path>` | `instinct-import.ts` | Import instincts from a JSON file |
| `/instinct-promote [id]` | `instinct-promote.ts` | Promote project instincts to global scope (auto-promote if no ID given) |
| `/instinct-evolve` | `instinct-evolve.ts` | LLM-powered analysis: suggests merges, duplicates, promotions, cleanup |
| `/instinct-graduate` | `instinct-graduate.ts` | Graduate mature instincts to AGENTS.md, skills, or commands |
| `/instinct-projects` | `instinct-projects.ts` | List known projects with instinct counts |
| `/instinct-dream` | `instinct-dream.ts` | Holistic consolidation review: merges, dedup, contradictions, promotions |

---

## Consolidation (Dream) Pass

Periodic holistic review of the entire instinct corpus, independent of new observations. Inspired by Claude Code's Auto Dream feature.

### Two entry points

1. **Automatic (normal analyzer run)**: After analyzing observations for all projects, the analyzer opportunistically runs consolidation for each project if `dreaming_enabled` is `true` (default) and the dual-gate conditions are met. No separate cron job needed.
2. **Manual CLI flag**: `npx tsx src/cli/analyze.ts --consolidate` - runs consolidation only (skips observation analysis), always forces past the gate check.
3. **Slash command**: `/instinct-dream` - interactive, runs in a Pi session with user confirmation.

### Dual-gate trigger (automatic mode)

Both conditions must be met before an automatic consolidation runs:
- At least `consolidation_interval_days` (default: 7) since last consolidation
- At least `consolidation_min_sessions` (default: 10) new sessions since last consolidation

Set `dreaming_enabled: false` in config to disable automatic consolidation entirely.

### Consolidation meta

Per-project state stored in `projects/<id>/consolidation.json`:
```json
{
  "last_consolidation_at": "2026-03-20T10:00:00Z",
  "last_consolidation_session_count": 42
}
```

Session count is derived from distinct `session` values in the project's `observations.jsonl`.

### What consolidation does

1. **Skips the observation pipeline** - no observations are read or analyzed
2. **Loads all instincts** (project + global)
3. **Sends a consolidation prompt** asking the LLM to:
   - Identify merge candidates (similar trigger + action)
   - Flag stale instincts (old, zero confirmations, high inactive count)
   - Resolve contradictions (opposing actions for similar triggers)
   - Suggest promotions (high-confidence project -> global)
   - Remove AGENTS.md duplicates
4. **Applies changes** via the same create/update/delete pipeline as normal analysis
5. **Updates consolidation meta** with timestamp and current session count

### Modules

| Module | Responsibility |
|---|---|
| `consolidation.ts` | Gate logic (pure), session counting, meta persistence |
| `prompts/consolidate-system.ts` | System prompt for automated consolidation |
| `prompts/consolidate-user.ts` | User prompt builder (instincts + AGENTS.md, no observations) |
| `prompts/dream-prompt.ts` | Interactive prompt for `/instinct-dream` command |
| `instinct-dream.ts` | `/instinct-dream` command handler |

### Rate limits

Consolidation allows `2x` the normal `max_new_instincts_per_run` creation rate limit, since merges produce new instincts while deleting originals.

---

## LLM Tools

Registered in `index.ts` via `registerAllTools()` from `instinct-tools.ts`.

| Tool | Purpose |
|---|---|
| `instinct_list` | List instincts with optional scope/domain filters |
| `instinct_read` | Read a specific instinct by ID |
| `instinct_write` | Create or update an instinct |
| `instinct_delete` | Remove an instinct by ID |
| `instinct_merge` | Merge multiple instincts into one, removing originals |

These tools are also reused by the standalone analyzer script (passed as `customTools` to `createAgentSession`).

---

## Instinct Graduation Pipeline

The graduation pipeline promotes mature instincts into permanent knowledge. Implemented across several modules:

### Lifecycle

```
Observation -> Instinct (days) -> AGENTS.md / Skill / Command (1-2 weeks)
                                    |
                                    v
                              TTL enforcement (28 days)
                              - Low confidence: deleted
                              - Moderate confidence: aggressively decayed
```

### Modules

| Module | Responsibility |
|---|---|
| `graduation.ts` | Pure functions: maturity checks, candidate scanning, domain clustering, TTL enforcement, `markGraduated()` |
| `instinct-graduate.ts` | `/instinct-graduate` command handler, action helpers (`graduateToAgentsMd`, `graduateToSkill`, `graduateToCommand`, `cullExpiredInstincts`, `decayExpiredInstincts`) |
| `skill-scaffold.ts` | Generates `SKILL.md` content from a `DomainCluster` (3+ related instincts) |
| `command-scaffold.ts` | Generates command scaffold content from a `DomainCluster` |
| `agents-md.ts` | Reads and writes AGENTS.md files (`appendToAgentsMd`, `generateAgentsMdDiff`) |

### Maturity Criteria (constants in `config.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `GRADUATION_MIN_AGE_DAYS` | 7 | Minimum age before eligible |
| `GRADUATION_MIN_CONFIDENCE` | 0.75 | Minimum confidence score |
| `GRADUATION_MIN_CONFIRMED` | 3 | Minimum confirmed_count |
| `GRADUATION_MAX_CONTRADICTED` | 1 | Maximum contradicted_count |
| `GRADUATION_SKILL_CLUSTER_SIZE` | 3 | Min instincts for skill scaffold |
| `GRADUATION_COMMAND_CLUSTER_SIZE` | 3 | Min instincts for command scaffold |
| `GRADUATION_TTL_MAX_DAYS` | 28 | Max age before TTL enforcement |
| `GRADUATION_TTL_CULL_CONFIDENCE` | 0.3 | Below this, TTL-expired instincts are deleted |

### Graduation Tracking

Graduated instincts have two additional fields in their YAML frontmatter:

```yaml
graduated_to: agents-md   # or "skill" or "command"
graduated_at: "2026-03-27T12:00:00.000Z"
```

These fields are:
- Parsed/serialized by `instinct-parser.ts`
- Checked by `graduation.ts` to skip already-graduated instincts
- Checked by `enforceTtl()` to skip graduated instincts from TTL culling
- Set by `markGraduated()` which returns a new instinct without mutating the original

### Command Flow (`/instinct-graduate`)

1. Load all instincts (project + global)
2. Read AGENTS.md (project + global) for dedup checking
3. `findAgentsMdCandidates()` - check maturity criteria for each instinct
4. `findSkillCandidates()` / `findCommandCandidates()` - find domain clusters >= 3 instincts
5. `enforceTtl()` - identify instincts past 28-day TTL
6. Build a summary prompt and send via `pi.sendUserMessage({ deliverAs: "followUp" })`
7. The LLM presents findings and asks for user approval before taking action
8. On approval, action helpers write to AGENTS.md / scaffold files and mark instincts graduated

---

## Analysis Event Log and Notifications

The background analyzer writes a summary of instinct changes after each project analysis. The extension reads these summaries and displays a brief notification when the user starts a new prompt.

### Event Log Format

Each project has an `analysis-events.jsonl` file under its project directory. Each line is a JSON object:

```json
{
  "timestamp": "2026-03-27T15:00:00Z",
  "project_id": "a1b2c3d4e5f6",
  "project_name": "my-app",
  "created": [{"id": "use-result-type", "title": "Use Result type", "scope": "project", "trigger": "...", "action": "..."}],
  "updated": [{"id": "read-before-edit", "title": "Read Before Edit", "scope": "global", "confidence_delta": 0.05}],
  "deleted": []
}
```

Events are only written when at least one change occurred (no-op runs produce no events).

### Concurrency: Atomic Rename Pattern

Multiple analyzer runs may write events before a Pi session reads them. The consume operation uses an atomic rename to prevent data loss:

1. **Analyzer writes**: `appendFileSync` to `analysis-events.jsonl` (append-only, creates if missing)
2. **Extension reads**: On `before_agent_start`, calls `consumeAnalysisEvents()` which:
   a. Checks for orphaned `.consumed` file from a prior crash - reads it first
   b. Atomically renames `analysis-events.jsonl` to `analysis-events.consumed` (POSIX rename is atomic)
   c. Reads all lines from `.consumed`
   d. Deletes `.consumed`

This is safe because:
- If the analyzer has the file open during rename, writes follow the inode (go to `.consumed`), so the extension gets that data too
- New analyzer writes after the rename create a fresh `analysis-events.jsonl`
- If the extension crashes between rename and delete, the orphaned `.consumed` is recovered on the next consume call

### Notification Display

The extension calls `checkAnalysisNotifications()` on every `before_agent_start`. If events exist, a one-line notification is shown via `ctx.ui.notify()`:

```
[instincts] Background analysis: +1 new (use-result-type), 2 updated, 0 deleted
```

Created instinct IDs are listed (up to 3, then `...`). The notification is brief and non-intrusive.

---

## Session Lifecycle

1. **`session_start`**: Load config, detect project, create storage dirs, clean old archives, load installed skills, register LLM tools.
2. **`before_agent_start`** (each turn): Record user prompt observation, check for analysis notifications (consume events, show summary), load and inject instincts into system prompt, store injected IDs in shared state.
3. **`tool_execution_start`** / **`tool_execution_end`** (each tool call): Record tool observations with scrubbed inputs/outputs and active instinct IDs.
4. **`agent_end`** (each turn): Record agent end observation, clear active instincts state.
5. **`session_shutdown`**: No cleanup needed (analyzer runs externally).
