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
Release lockfile
```

**Lockfile guard** (`analyze.lock`): A JSON file containing `{pid, started_at}`. Before starting, the script checks if the lock exists. If the owning PID is still alive and the lock is < 10 minutes old, the script exits with code 0. If the PID is dead or the lock is stale, it's treated as orphaned and overridden.

**Global timeout**: The process exits with code 2 after 5 minutes regardless of progress.

**Auto-cleanup** (`instinct-cleanup.ts`): Before decay, `runCleanupPass()` enforces three rules: (1) deletes `flagged_for_removal` instincts whose `updated_at` is older than `flagged_cleanup_days`; (2) deletes instincts with `confirmed_count === 0` older than `instinct_ttl_days`; (3) deletes the lowest-confidence instincts when the total count exceeds `max_total_instincts_per_project` or `max_total_instincts_global`.

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

| Outcome | Delta |
|---|---|
| Confirmed | +0.05 |
| Contradicted | -0.15 |
| Inactive | 0 |

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

`formatInstinctsCompact()` in `cli/analyze-single-shot.ts` serializes instincts as a compact JSON array instead of full YAML frontmatter + markdown body. Each entry contains only the fields the model needs: `{id, trigger, action, confidence, domain, scope, confirmed, contradicted, inactive, age_days}`.

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

## Session Lifecycle

1. **`session_start`**: Load config, detect project, create storage dirs, clean old archives, load installed skills, register LLM tools.
2. **`before_agent_start`** (each turn): Record user prompt observation, load and inject instincts into system prompt, store injected IDs in shared state.
3. **`tool_execution_start`** / **`tool_execution_end`** (each tool call): Record tool observations with scrubbed inputs/outputs and active instinct IDs.
4. **`agent_end`** (each turn): Record agent end observation, clear active instincts state.
5. **`session_shutdown`**: No cleanup needed (analyzer runs externally).
