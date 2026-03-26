# Internals

How pi-continuous-learning works under the hood. Covers the data flow, file layout, configuration, and module responsibilities.

---

## Storage Layout

All data lives under `~/.pi/continuous-learning/`. The extension creates this structure on first `session_start` via `ensureStorageLayout()` in `storage.ts`.

```
~/.pi/continuous-learning/
  config.json                          # User config overrides (optional)
  projects.json                        # Registry mapping project hash -> metadata
  instincts/
    personal/                          # Global instincts (user-created)
      prefer-grep-before-edit.md
    inherited/                         # Imported global instincts
  projects/
    <12-char-hash>/
      project.json                     # Project metadata snapshot
      observations.jsonl               # Current observation log (append-only)
      observations.archive/            # Rotated observation files
        2026-03-15T10-30-00-000Z.jsonl
      instincts/
        personal/                      # Project-scoped instincts
          use-result-type.md
        inherited/                     # Imported project instincts
      analyzer.log                     # Error/warning log for this project
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
| `project.json` | `ensureStorageLayout()` | JSON | First time a project is seen |
| `observations.jsonl` | `appendObservation()` | JSONL (one JSON object per line) | Every tool call, prompt, and agent end |
| `*.jsonl` in archive | `appendObservation()` | JSONL | When `observations.jsonl` hits 10 MB |
| `<id>.md` in instincts dirs | Haiku analyzer subprocess | YAML frontmatter + Markdown | Every analysis run |
| `analyzer.log` | `logError()` / `logWarning()` | Plain text with timestamps | On errors or subprocess warnings |

---

## Configuration

Defined in `config.ts`. The extension reads `~/.pi/continuous-learning/config.json` once on `session_start` and caches the result for the session. If the file is missing or malformed, defaults are used.

### Default values

```typescript
{
  run_interval_minutes: 5,           // How often the analyzer runs
  min_observations_to_analyze: 20,   // Minimum observations before analysis triggers
  min_confidence: 0.5,               // Instincts below this are not injected
  max_instincts: 20,                 // Cap on instincts injected per turn
  model: "claude-haiku-4-5",         // Model for the analyzer subprocess
  timeout_seconds: 120,              // Kill analyzer subprocess after this
  active_hours_start: 8,             // Don't run analyzer before 8am local
  active_hours_end: 23,              // Don't run analyzer after 11pm local
  max_idle_seconds: 1800,            // Skip analysis if no observation in 30 min
}
```

### Partial overrides

The config file only needs to contain fields you want to change. TypeBox `Value.Clean` strips unknown keys, then the partial is merged over defaults:

```json
{
  "run_interval_minutes": 10,
  "min_confidence": 0.6
}
```

---

## Project Detection

`project.ts` identifies the current project so observations and instincts are scoped correctly. Resolution order:

1. Run `git remote get-url origin` in `ctx.cwd` - if it succeeds, SHA-256 hash the remote URL and take the first 12 hex characters as the project ID.
2. Fallback: run `git rev-parse --show-toplevel` and hash the repo root path instead.
3. Final fallback: use the literal string `"global"` as the project ID.

The project name is always `basename(ctx.cwd)`. Both git commands are run via `pi.exec()`, not `child_process`, so they go through Pi's process management.

The 12-character hash means the same repo produces the same ID across machines (as long as the remote URL matches), which makes instincts portable.

---

## Data Flow

### 1. Observation Collection

```
Pi event (tool_execution_start, tool_execution_end, before_agent_start, agent_end)
  |
  v
observer-guard.ts  -- skip if analyzer is running or path is inside ~/.pi/continuous-learning/
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

**Self-observation prevention** (`observer-guard.ts`): A boolean flag `analyzerRunning` is set true before the analyzer subprocess starts and cleared when it finishes. While true, all observation writes are skipped. Additionally, any tool call whose file path falls under `~/.pi/continuous-learning/` is skipped regardless of the flag.

**Secret scrubbing** (`scrubber.ts`): Nine regex patterns match common secret formats - Authorization headers, Bearer tokens, API keys, access tokens, passwords, AWS access key IDs (`AKIA...`), and Anthropic API keys (`sk-ant-...`). All matches are replaced with `[REDACTED]` before the observation is written to disk.

**Truncation**: Tool inputs are capped at 5,000 characters, tool outputs at 5,000 characters. Truncation happens after scrubbing.

**Active instincts tagging**: Every observation includes an `active_instincts` field (when non-empty) listing the IDs of instincts that were injected into the system prompt for the current turn. This is the bridge for the feedback loop - the analyzer later cross-references this against actual behavior.

### 2. Background Analysis

```
setInterval (every run_interval_minutes)
  |
  v
analyzer-timer.ts  -- check guards: enough observations? active hours? not idle? not already running?
  |
  v
analyzer-runner.ts -- re-entrancy guard, cooldown check, run passive decay, spawn subprocess
  |
  v
analyzer-spawn.ts  -- spawn("pi", [...flags], { cwd, stdio: ["ignore", "pipe", "pipe"] })
  |
  v
Pi CLI subprocess   -- reads observations, reads/writes instinct .md files using read/write tools
  |
  v
analyzer-stream.ts -- parse NDJSON from stdout, track filesWritten, detect agent_end
```

**Timer guards** (`analyzer-timer.ts`): Before each tick fires the analysis callback, four conditions are checked in order:

| Guard | Condition to skip |
|---|---|
| `in_progress` | Another analysis is already running |
| `insufficient_observations` | Fewer than `min_observations_to_analyze` lines in `observations.jsonl` |
| `outside_active_hours` | Current local hour is outside `[active_hours_start, active_hours_end)` |
| `user_idle` | Last observation timestamp is older than `max_idle_seconds` |

**Runner guards** (`analyzer-runner.ts`): Even if the timer fires, the runner has its own re-entrancy check (`_isRunning` flag) and a cooldown (60 seconds minimum between runs).

**Passive decay** (`instinct-decay.ts`): Before each analysis, the runner calls `runDecayPass()` which walks all personal instinct files (project + global), applies -0.02 per week since `updated_at`, and saves any that changed by more than 0.001 confidence. Instincts that drop below 0.1 get `flagged_for_removal: true`.

**Subprocess spawn** (`analyzer-spawn.ts`): The exact CLI invocation:

```
pi --mode json -p --no-session --tools read,write --no-extensions --no-skills \
   --no-prompt-templates --no-themes --model claude-haiku-4-5 \
   --append-system-prompt /tmp/pi-cl-xxx/system-prompt.txt \
   "<user prompt with observations>"
```

Key flags:
- `--mode json` - structured NDJSON output on stdout
- `-p` - print mode (non-interactive, exits when done)
- `--no-extensions --no-skills --no-prompt-templates --no-themes` - prevents this extension from loading in the subprocess (no infinite loops)
- `--tools read,write` - only tools the analyzer needs
- `--no-session` - ephemeral, no session history saved

The subprocess reuses the user's Pi OAuth credentials from `~/.pi/agent/auth.json`. No separate API key is needed.

**Stream parsing** (`analyzer-stream.ts`): Reads NDJSON lines from the subprocess stdout via `readline`. Tracks:
- `tool_execution_end` events for `write` tool - collects file paths written
- `tool_execution_end` events with errors - collects error messages
- `agent_end` event - marks success

**Timeout**: A `setTimeout` kills the subprocess with SIGTERM after `timeout_seconds` (default 120s). The process is also killed on `session_shutdown`.

### 3. System Prompt Injection

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

**Feedback bridge** (`active-instincts.ts`): A simple module-level `string[]` that the injector writes and the observer reads. Set on `before_agent_start`, cleared on `agent_end`. This is what populates the `active_instincts` field on observations, closing the feedback loop.

### 4. Analyzer Prompts

**System prompt** (`prompts/analyzer-system.ts`): A static template written to a temp file once per session. Contains:
- Instinct file format specification (YAML frontmatter schema)
- Pattern detection heuristics (user corrections, error resolutions, repeated workflows, tool preferences, anti-patterns)
- Feedback analysis instructions (confirmed/contradicted/inactive outcomes)
- Confidence scoring rules (initial brackets + feedback deltas + passive decay + clamping)
- Scope decision guide (project vs global)
- Conservativeness rules (minimum 3 observations, no code snippets, no duplication, etc.)

**User prompt** (`prompts/analyzer-user.ts`): Built fresh each run. Contains:
- Project context (ID and name)
- Absolute file paths for observations and instincts directory
- The last 500 observation lines from `observations.jsonl` (inlined, not a file reference)
- Step-by-step instructions: read existing instincts, analyze observations, create/update instinct files, apply feedback, apply decay

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
  - "Confirmed: agent grepped before editing while instinct was active (3/25)"
---

Search for the relevant symbol or string with grep before opening a file for editing.
Confirm the match with read, then apply the edit.
```

**ID validation**: Must be kebab-case (`/^[a-z0-9]+(-[a-z0-9]+)*$/`). Path traversal characters (`..`, `/`, `\`) are rejected by both the parser and the store.

**Confidence clamping**: Always [0.1, 0.9]. Values outside this range are clamped on parse and serialize.

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

-0.02 per week since `updated_at`. Applied by `runDecayPass()` before each analysis run.

### Clamping and removal

All values clamped to [0.1, 0.9]. If the pre-clamp value drops below 0.1, `flagged_for_removal` is set to `true`. Flagged instincts are excluded from injection but not deleted - users can review them via `/instinct-status`.

---

## Observation File Management

`observations.ts` handles the JSONL append log.

- **Write**: `appendFileSync` - one JSON line per observation. No buffering.
- **Rotation**: When the file reaches 10 MB, it's renamed to `observations.archive/<ISO-timestamp>.jsonl` before the next write.
- **Cleanup**: On `session_start`, `cleanOldArchives()` deletes archived files with `mtime` older than 30 days.

---

## Logging

`error-logger.ts` writes structured entries to `projects/<id>/analyzer.log` at three levels:

### Info (lifecycle tracking)

```
[2026-03-25T14:30:00.000Z] [analyzer-timer] Info: Tick skipped: not enough observations
[2026-03-25T14:35:00.000Z] [analyzer-timer] Info: Tick fired: starting analysis
[2026-03-25T14:35:01.000Z] [analyzer-runner] Info: Analysis started
[2026-03-25T14:35:45.000Z] [analyzer-runner] Info: Analysis completed: 2 file(s) written
```

The analyzer timer logs every tick - either the skip reason (`not enough observations`, `analysis already in progress`, `outside active hours`, `user idle`) or that it fired. The runner logs when analysis starts, completes (with file count), or is skipped due to its own guards (re-entrancy, cooldown).

### Warning (non-fatal issues)

```
[2026-03-25T14:35:45.000Z] [analyzer-runner] Warning: Subprocess failed. stderr: ...
```

### Error (failures with stack traces)

```
[2026-03-25T14:30:00.000Z] [analyzer-runner:runAnalysis] Error: Subprocess timed out
Stack: Error: Subprocess timed out
    at ...
```

### Behavior

- If `projectId` is null (project detection failed), errors and warnings fall back to `console.warn`. Info messages are silently dropped.
- The logger itself never throws - all I/O failures are silently swallowed.
- Every event handler in `index.ts` wraps its body in try/catch and routes errors through `logError()`.
- To check if the analyzer has ever run, look for `analyzer.log` in the project directory and check for Info lines from `analyzer-runner`.

---

## Module Dependency Graph

```
index.ts (entry point)
  |-- config.ts              -- load config from disk
  |-- project.ts             -- detect project via git
  |-- storage.ts             -- directory layout + projects registry
  |-- observations.ts        -- JSONL append + archive + cleanup
  |-- tool-observer.ts       -- tool_execution_start/end handlers
  |-- prompt-observer.ts     -- before_agent_start/agent_end observation handlers
  |-- instinct-injector.ts   -- before_agent_start injection + agent_end cleanup
  |   |-- instinct-loader.ts -- load + filter + sort instincts
  |   |   |-- instinct-store.ts   -- CRUD for instinct files
  |   |   |   |-- instinct-parser.ts  -- YAML frontmatter parse/serialize
  |   |-- active-instincts.ts     -- shared state: current injected IDs
  |-- analyzer-timer.ts      -- setInterval management + skip guards
  |-- analyzer-runner.ts     -- subprocess lifecycle + timeout + cooldown
  |   |-- analyzer-spawn.ts  -- build args + spawn("pi", ...)
  |   |-- analyzer-stream.ts -- NDJSON stdout parsing
  |   |-- instinct-decay.ts  -- passive confidence decay pass
  |       |-- confidence.ts  -- pure confidence math
  |-- observer-guard.ts      -- self-observation prevention
  |-- scrubber.ts            -- secret redaction
  |-- error-logger.ts        -- append to analyzer.log
  |-- prompts/
  |   |-- analyzer-system.ts -- static system prompt template
  |   |-- analyzer-user.ts   -- per-run user prompt with observations
  |-- instinct-status.ts     -- /instinct-status command
  |-- instinct-export.ts     -- /instinct-export command
  |-- instinct-import.ts     -- /instinct-import command
  |-- instinct-promote.ts    -- /instinct-promote command
  |-- instinct-evolve.ts     -- /instinct-evolve command
  |-- instinct-projects.ts   -- /instinct-projects command
```

---

## Slash Commands

All registered in `index.ts` via `pi.registerCommand()`.

| Command | Handler | What it does |
|---|---|---|
| `/instinct-status` | `instinct-status.ts` | List all instincts grouped by domain with confidence, feedback counts, trend arrows |
| `/instinct-export` | `instinct-export.ts` | Export instincts to a JSON file (filterable by scope/domain) |
| `/instinct-import <path>` | `instinct-import.ts` | Import instincts from a JSON file |
| `/instinct-promote [id]` | `instinct-promote.ts` | Promote project instincts to global scope (auto-promote if no ID given) |
| `/instinct-evolve` | `instinct-evolve.ts` | Cluster related instincts and suggest consolidations |
| `/instinct-projects` | `instinct-projects.ts` | List known projects with instinct counts |

---

## Session Lifecycle

1. **`session_start`**: Load config, detect project, create storage dirs, clean old archives, write analyzer system prompt to temp file, start analyzer timer.
2. **`before_agent_start`** (each turn): Record user prompt observation, load and inject instincts into system prompt, store injected IDs in shared state.
3. **`tool_execution_start`** / **`tool_execution_end`** (each tool call): Record tool observations with scrubbed inputs/outputs and active instinct IDs.
4. **`agent_end`** (each turn): Record agent end observation, clear active instincts state.
5. **Timer tick** (every `run_interval_minutes`): Check guards, spawn Haiku subprocess, parse results.
6. **`session_shutdown`**: Stop timer, kill any running analyzer subprocess.
