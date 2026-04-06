# PRD: Pi Continuous Learning Extension

## 1. Introduction/Overview

A Pi extension that passively observes coding sessions, records tool calls and user interactions as observations, runs a background Haiku-powered analyzer to detect behavioral patterns, and distills them into "instincts" - atomic learned behaviors stored as YAML-frontmatter markdown files with confidence scoring.

The system forms a closed feedback loop: instincts are injected into the system prompt, the observer tracks whether the agent's behavior aligns with or contradicts active instincts, and the analyzer adjusts confidence based on real outcomes rather than observation frequency alone.

## 2. Goals

- Automatically capture tool calls, user prompts, and outcomes during Pi sessions
- Detect recurring behavioral patterns from observations using a background Haiku subprocess
- Create and maintain instinct files with outcome-based confidence scoring
- Inject high-confidence instincts into system prompts to improve agent behavior
- Close the feedback loop: confirm, contradict, or mark instincts inactive based on actual session behavior
- Provide slash commands for instinct management (status, export, import, promote, evolve)
- Store all data locally under `~/.pi/continuous-learning/` with no external dependencies

## 3. User Stories

---

### Phase 1: Core Infrastructure

#### US-001: Project Scaffolding

**Description:** As a developer, I want the project scaffolded as a pi-package with correct manifest, TypeScript config, and dependencies so that development can begin.

**Acceptance Criteria:**

- [ ] `package.json` exists with `name: "pi-continuous-learning"`, `keywords: ["pi-package"]`, and `pi.extensions: ["src/index.ts"]`
- [ ] `peerDependencies` include `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `@mariozechner/pi-tui`, `@sinclair/typebox`
- [ ] `tsconfig.json` has `strict: true`
- [ ] `vitest.config.ts` is configured
- [ ] ESLint is configured
- [ ] `src/index.ts` exports a default function that accepts `ExtensionAPI` and is a no-op
- [ ] Extension loads in Pi without errors (`pi -e ./src/index.ts`)
- [ ] `npm run test`, `npm run lint`, `npm run build` all pass

---

#### US-002: Shared Type Definitions

**Description:** As a developer, I want all shared TypeScript interfaces defined in `types.ts` so that modules have consistent data contracts.

**Acceptance Criteria:**

- [ ] `Observation` interface defined with fields: `timestamp`, `event`, `tool`, `input`, `output`, `session`, `project_id`, `project_name`, `is_error`, `active_instincts`
- [ ] `event` field is a union type: `"tool_start" | "tool_complete" | "user_prompt" | "agent_end"`
- [ ] `Instinct` interface defined with all frontmatter fields: `id`, `trigger`, `confidence`, `domain`, `source`, `scope`, `project_id`, `project_name`, `created_at`, `updated_at`, `observation_count`, `confirmed_count`, `contradicted_count`, `inactive_count`, `title`, `action`, `evidence`
- [ ] `ProjectEntry` interface defined with: `id`, `name`, `root`, `remote`, `created_at`, `last_seen`
- [ ] `Config` interface defined matching the config.json schema from the spec
- [ ] Unit tests verify type exports are accessible

---

#### US-003: Configuration Module

**Description:** As a developer, I want a configuration module that loads user settings from `~/.pi/continuous-learning/config.json` with sensible defaults so that all modules share consistent configuration.

**Acceptance Criteria:**

- [ ] `loadConfig()` reads from `~/.pi/continuous-learning/config.json`
- [ ] When config file is absent, returns a complete default config object
- [ ] When config file has partial overrides, merges them with defaults (overrides win)
- [ ] Invalid JSON in config file logs a warning and returns defaults
- [ ] Default values match the spec: `run_interval_minutes: 5`, `min_observations_to_analyze: 20`, `min_confidence: 0.5`, `max_instincts: 20`, `model: "claude-haiku-4-5"`, `timeout_seconds: 120`, etc.
- [ ] Config is loaded once on `session_start` and cached in module state
- [ ] Unit tests cover: missing file, valid file, partial override, invalid JSON

---

#### US-004: Project Detection

**Description:** As a developer, I want project detection via git remote URL hashing so that observations and instincts are scoped to the correct project.

**Acceptance Criteria:**

- [ ] `detectProject(pi, cwd)` returns a `ProjectEntry`
- [ ] Uses `pi.exec("git", ["remote", "get-url", "origin"])` to get the remote URL
- [ ] Project ID is the first 12 characters of SHA256 hash of the remote URL
- [ ] Falls back to `git rev-parse --show-toplevel` when no remote exists, hashing the repo path
- [ ] Falls back to project ID `"global"` when not in a git repo
- [ ] `project_name` is the basename of `cwd`
- [ ] Unit tests cover: remote URL detected, no remote (path fallback), not a git repo (global fallback)

---

#### US-005: Storage Layout Creation

**Description:** As a developer, I want the storage directory structure created on first use so that observation and instinct files have a place to live.

**Acceptance Criteria:**

- [ ] `ensureStorageLayout(projectId)` creates `~/.pi/continuous-learning/` root directory
- [ ] Creates `projects/<projectId>/instincts/personal/` and `projects/<projectId>/instincts/inherited/`
- [ ] Creates `instincts/personal/` and `instincts/inherited/` (global)
- [ ] Creates `projects/<projectId>/observations.archive/`
- [ ] Writes `projects/<projectId>/project.json` with project metadata if it does not exist
- [ ] Updates `projects.json` registry with the project entry
- [ ] Idempotent - safe to call multiple times
- [ ] Unit tests use `tmp_path` to verify directory creation and idempotency

---

#### US-006: Instinct File Parsing and Serialization

**Description:** As a developer, I want to parse instinct markdown files (YAML frontmatter + body) into `Instinct` objects and serialize them back so that instincts can be read, created, and updated.

**Acceptance Criteria:**

- [ ] `parseInstinct(content)` extracts YAML frontmatter and markdown body into an `Instinct` object
- [ ] `serializeInstinct(instinct)` produces valid YAML-frontmatter markdown matching the spec format
- [ ] Round-trip: `serializeInstinct(parseInstinct(content))` preserves all data
- [ ] Handles missing optional fields gracefully (e.g., `project_id` for global instincts)
- [ ] Validates `id` is kebab-case (lowercase, hyphens, no special characters)
- [ ] Validates `confidence` is clamped to 0.1 - 0.9 range
- [ ] Throws on invalid frontmatter (missing required fields)
- [ ] Unit tests cover: valid parse, round-trip, missing optional fields, invalid id, out-of-range confidence

---

#### US-007: Instinct CRUD Operations

**Description:** As a developer, I want functions to load, save, list, and delete instinct files from disk so that the analyzer and injector can manage instincts.

**Acceptance Criteria:**

- [ ] `loadInstinct(filePath)` reads a `.md` file and returns an `Instinct` object
- [ ] `saveInstinct(instinct, dir)` writes an instinct to `<dir>/<id>.md`
- [ ] `listInstincts(dir)` returns all instincts from a directory
- [ ] `loadProjectInstincts(projectId)` loads from `projects/<projectId>/instincts/personal/`
- [ ] `loadGlobalInstincts()` loads from `instincts/personal/`
- [ ] File paths are validated against path traversal (no `..` in instinct IDs)
- [ ] Unit tests use `tmp_path` to verify file I/O, path traversal rejection

---

#### US-008: Instinct Confidence Calculations

**Description:** As a developer, I want confidence scoring functions that handle both discovery-based initial scoring and feedback-based adjustments so that instinct confidence reflects real outcomes.

**Acceptance Criteria:**

- [ ] `initialConfidence(observationCount)` returns: 0.3 for 1-2, 0.5 for 3-5, 0.7 for 6-10, 0.85 for 11+
- [ ] `adjustConfidence(current, outcome)` applies: +0.05 for confirmed, -0.15 for contradicted, 0 for inactive
- [ ] `applyPassiveDecay(confidence, lastUpdated)` applies -0.02 per week since last update
- [ ] Confidence is always clamped to 0.1 - 0.9
- [ ] Below 0.1 (after clamping), sets `flagged_for_removal: true` on the instinct
- [ ] Unit tests cover: all observation count brackets, each outcome type, decay over time, clamping at boundaries

---

### Phase 2: Observation Collection

#### US-009: Tool Call Observation

**Description:** As a developer, I want tool_call and tool_result events captured as observations so that the analyzer can detect patterns in tool usage.

**Acceptance Criteria:**

- [ ] `tool_execution_start` handler records an observation with `event: "tool_start"`, tool name, and truncated input (max 5000 chars)
- [ ] `tool_execution_end` handler records an observation with `event: "tool_complete"`, tool name, truncated output (max 5000 chars), and `is_error` flag
- [ ] Observations include `timestamp` (ISO 8601 UTC), `session`, `project_id`, `project_name`
- [ ] Unit tests verify event capture, field population, and input/output truncation

---

#### US-010: User Prompt and Agent End Observation

**Description:** As a developer, I want user prompts and agent completions captured as observations so that the analyzer has full session context.

**Acceptance Criteria:**

- [ ] `agent_start` handler records an observation with `event: "user_prompt"` and the user's prompt text (from `event.prompt` via `before_agent_start`)
- [ ] `agent_end` handler records an observation with `event: "agent_end"`
- [ ] Unit tests verify both event types are captured with correct fields

---

#### US-011: Self-Observation Prevention

**Description:** As a developer, I want the observer to skip its own analyzer's activity so that the system does not create infinite observation loops.

**Acceptance Criteria:**

- [ ] A module-level boolean flag `isAnalyzerRunning` gates observation recording
- [ ] When `isAnalyzerRunning` is true, all observation handlers return without writing
- [ ] Observations for file paths under `~/.pi/continuous-learning/` are also skipped (path-based filter)
- [ ] Unit tests verify observations are suppressed when the flag is set and for filtered paths

---

#### US-012: Secret Scrubbing

**Description:** As a developer, I want secrets scrubbed from observation data before it is written to disk so that API keys and passwords are never stored in plain text.

**Acceptance Criteria:**

- [ ] `scrubSecrets(text)` replaces matches of the regex pattern from the spec with `[REDACTED]`
- [ ] Pattern matches: API keys, tokens, passwords, authorization headers, credentials
- [ ] Scrubbing is applied to both `input` and `output` fields before writing
- [ ] Does not modify non-secret text
- [ ] Unit tests cover: API key formats, bearer tokens, password fields, no false positives on normal code

---

#### US-013: Active Instincts Tagging

**Description:** As a developer, I want each observation tagged with the IDs of instincts currently injected into the system prompt so that the analyzer can perform feedback analysis.

**Acceptance Criteria:**

- [ ] Observer reads `currentActiveInstincts` from shared module state (set by injector)
- [ ] Every observation written during a turn where instincts were injected includes `active_instincts: string[]`
- [ ] When no instincts are active, `active_instincts` is omitted or empty
- [ ] Unit tests verify tagging when instincts are active and absent

---

#### US-014: JSONL File Writing and Archival

**Description:** As a developer, I want observations written as append-only JSONL with automatic archival when the file exceeds 10MB so that storage is managed.

**Acceptance Criteria:**

- [ ] `appendObservation(observation, projectId)` appends one JSON line to `projects/<projectId>/observations.jsonl`
- [ ] Before writing, checks file size; if >= 10MB, moves file to `observations.archive/<timestamp>.jsonl`
- [ ] Archived files older than 30 days are deleted (checked once per `session_start`)
- [ ] Unit tests verify: append, archival trigger at size threshold, old archive cleanup

---

### Phase 3: Background Analyzer

#### US-015: Pi CLI Subprocess Spawning

**Description:** As a developer, I want the analyzer to spawn a Pi CLI subprocess with the correct flags so that analysis runs in an isolated process using the user's subscription credentials.

**Acceptance Criteria:**

- [ ] `spawnAnalyzer(systemPromptFile, userPrompt, cwd)` spawns `pi` with args: `--mode json`, `-p`, `--no-session`, `--model claude-haiku-4-5`, `--tools read,write`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, `--append-system-prompt <file>`
- [ ] User prompt is passed as the final positional argument
- [ ] Subprocess stdio: stdin ignored, stdout piped, stderr piped
- [ ] Returns a handle with the child process and a promise for completion
- [ ] Unit tests verify correct argument construction (mock `child_process.spawn`)

---

#### US-016: JSON Event Stream Parsing

**Description:** As a developer, I want the analyzer to parse JSON events from the subprocess stdout so that we can monitor analysis progress and detect success/failure.

**Acceptance Criteria:**

- [ ] Parses newline-delimited JSON from stdout
- [ ] Tracks `tool_execution_end` events to detect what files were written
- [ ] Detects `agent_end` as successful completion
- [ ] Handles malformed JSON lines gracefully (log warning, skip line)
- [ ] Returns an `AnalysisResult` with: success boolean, files written, errors encountered
- [ ] Unit tests verify parsing of valid events, malformed lines, and result extraction

---

#### US-017: Analyzer Timeout and Process Management

**Description:** As a developer, I want the analyzer subprocess killed after 120 seconds and on session shutdown so that hung analyses cannot affect the system.

**Acceptance Criteria:**

- [ ] Subprocess is killed with SIGTERM after `timeout_seconds` (default 120)
- [ ] On `session_shutdown`, any running subprocess is killed immediately
- [ ] Re-entrancy guard: a boolean flag prevents concurrent analyses
- [ ] Cooldown: minimum 60 seconds between analysis runs
- [ ] Unit tests verify: timeout kills process, shutdown kills process, concurrent run prevented

---

#### US-018: Analyzer System Prompt Construction

**Description:** As a developer, I want the analyzer system prompt to contain instinct format specs, pattern detection rules, feedback analysis instructions, and confidence scoring guidelines so that Haiku produces correct instinct files.

**Acceptance Criteria:**

- [ ] System prompt is written to a temp file and passed via `--append-system-prompt`
- [ ] Includes the exact instinct file format (YAML frontmatter + markdown structure)
- [ ] Includes pattern detection heuristics: user corrections, error resolutions, repeated workflows, tool preferences
- [ ] Includes feedback analysis section: how to cross-reference `active_instincts` against observed behavior (confirmed/contradicted/inactive logic)
- [ ] Includes confidence scoring rules (both discovery and feedback adjustments)
- [ ] Includes scope decision guide (project vs global)
- [ ] Includes rules: be conservative, only clear patterns with 3+ observations, never include code snippets
- [ ] Unit tests verify the prompt contains required sections

---

#### US-019: Analyzer User Prompt Construction

**Description:** As a developer, I want the user prompt to tell Haiku where to find observations and instincts and what project context applies so that the analyzer reads and writes the correct files.

**Acceptance Criteria:**

- [ ] User prompt includes the absolute path to `observations.jsonl`
- [ ] User prompt includes the absolute path to the instincts directory
- [ ] User prompt includes project context: `project_id`, `project_name`
- [ ] Observations are tailed to max 500 entries before analysis
- [ ] Unit tests verify prompt contains required paths and context

---

#### US-020: Analyzer Timer Management

**Description:** As a developer, I want the analyzer to run on a configurable interval during active sessions so that patterns are detected periodically without manual intervention.

**Acceptance Criteria:**

- [ ] `startAnalyzerTimer()` sets up a `setInterval` with `run_interval_minutes` from config (default 5 min)
- [ ] Timer is started on `session_start`
- [ ] Timer is cleared on `session_shutdown`
- [ ] Each tick checks: enough observations accumulated (>= `min_observations_to_analyze`), no analysis in progress, within active hours, user not idle > 30 min
- [ ] Skips analysis run if any check fails
- [ ] Unit tests verify: timer starts/stops, skip conditions

---

### Phase 4: System Prompt Injection and Feedback Bridge

#### US-021: Instinct Loading and Filtering

**Description:** As a developer, I want instincts loaded, filtered by confidence threshold, sorted, and capped so that only the most relevant instincts are injected.

**Acceptance Criteria:**

- [ ] Loads project-scoped instincts (if in a project) and global instincts
- [ ] Filters to `confidence >= min_confidence` (default 0.5, configurable)
- [ ] Sorts by confidence descending
- [ ] Takes top N instincts (default 20, configurable via `max_instincts`)
- [ ] Excludes instincts with `flagged_for_removal: true`
- [ ] Unit tests verify: filtering, sorting, cap, exclusion of flagged instincts

---

#### US-022: System Prompt Injection via before_agent_start

**Description:** As a developer, I want filtered instincts appended to the system prompt on each `before_agent_start` event so that the agent benefits from learned behaviors.

**Acceptance Criteria:**

- [ ] Handler registered on `before_agent_start`
- [ ] Returns `{ systemPrompt: event.systemPrompt + injectionBlock }` with the instincts formatted as specified: `## Learned Behaviors (Instincts)` header, bullet list with `[confidence] trigger: action`
- [ ] When no instincts qualify, does not modify the system prompt
- [ ] Unit tests verify: injection format, no-op when empty

---

#### US-023: Active Instincts State Bridge

**Description:** As a developer, I want the injector to store the list of injected instinct IDs in shared module state so that the observer can tag observations for feedback analysis.

**Acceptance Criteria:**

- [ ] After injection, sets module-level `currentActiveInstincts: string[]` with the IDs of injected instincts
- [ ] Resets to empty array on `agent_end` (so next prompt starts clean)
- [ ] Observer (US-013) reads this state when writing observations
- [ ] Unit tests verify: state is set after injection, cleared after agent_end

---

### Phase 5: Commands

#### US-024: /instinct-status Command

**Description:** As a user, I want to run `/instinct-status` to see all instincts grouped by domain with confidence scores and feedback stats so that I can understand what the system has learned.

**Acceptance Criteria:**

- [ ] Registered via `pi.registerCommand("instinct-status", ...)`
- [ ] Displays instincts grouped by domain
- [ ] Each instinct shows: title, confidence score, trend arrow (up/down/stable based on recent confirmed vs contradicted), feedback ratio (`confirmed/contradicted/inactive`)
- [ ] Flagged-for-removal instincts are highlighted
- [ ] Output uses `ctx.ui.notify` or prints formatted text
- [ ] Unit tests verify grouping and formatting logic

---

#### US-025: /instinct-export Command

**Description:** As a user, I want to run `/instinct-export` to save instincts to a JSON file so that I can share or back them up.

**Acceptance Criteria:**

- [ ] Registered via `pi.registerCommand("instinct-export", ...)`
- [ ] Accepts optional args for scope (`project` or `global`) and domain filter
- [ ] Writes a JSON file with an array of instinct objects to the current directory
- [ ] Filename: `instincts-export-<timestamp>.json`
- [ ] Confirms file path via `ctx.ui.notify`
- [ ] Unit tests verify JSON output matches instinct data

---

#### US-026: /instinct-import Command

**Description:** As a user, I want to run `/instinct-import <path>` to load instincts from a JSON file so that I can import shared instincts.

**Acceptance Criteria:**

- [ ] Registered via `pi.registerCommand("instinct-import", ...)`
- [ ] Reads the JSON file at the given path
- [ ] Validates each instinct object (required fields, valid id format)
- [ ] Saves imported instincts to `instincts/inherited/` (global) or `projects/<id>/instincts/inherited/` (project) based on scope field
- [ ] Skips instincts with duplicate IDs (warns user)
- [ ] Reports count of imported instincts via `ctx.ui.notify`
- [ ] Unit tests verify import, validation, duplicate handling

---

#### US-027: /instinct-promote Command

**Description:** As a user, I want to run `/instinct-promote [id]` to promote project instincts to global scope so that good patterns are reused across projects.

**Acceptance Criteria:**

- [ ] Registered via `pi.registerCommand("instinct-promote", ...)`
- [ ] With an ID argument: promotes that specific project instinct to global (copies to `instincts/personal/`, updates scope to `global`, removes `project_id`/`project_name`)
- [ ] Without an ID: auto-promotes all qualifying instincts (confidence >= 0.8, seen in 2+ projects)
- [ ] Does not delete the project-scoped original
- [ ] Reports promoted instincts via `ctx.ui.notify`
- [ ] Unit tests verify manual and auto promotion logic

---

#### US-028: /instinct-evolve Command

**Description:** As a user, I want to run `/instinct-evolve` to see suggestions for clustering related instincts into higher-order constructs so that instincts can be consolidated.

**Acceptance Criteria:**

- [ ] Registered via `pi.registerCommand("instinct-evolve", ...)`
- [ ] Clusters instincts by domain and trigger similarity
- [ ] Suggests: related instincts that could merge, workflow instincts that could become commands, project instincts ready for global promotion
- [ ] Displays suggestions via `ctx.ui.notify` or formatted output
- [ ] Does not auto-apply changes (informational only)
- [ ] Unit tests verify clustering logic produces reasonable groupings

---

#### US-029: /instinct-projects Command

**Description:** As a user, I want to run `/instinct-projects` to see all known projects and their instinct counts so that I can understand what has been learned per project.

**Acceptance Criteria:**

- [ ] Registered via `pi.registerCommand("instinct-projects", ...)`
- [ ] Reads `projects.json` registry
- [ ] For each project, counts instinct files in `projects/<id>/instincts/personal/`
- [ ] Displays: project name, project ID, instinct count, last seen date
- [ ] Unit tests verify correct count aggregation

---

### Phase 6: Polish

#### US-030: Session Guardian (Active Hours and Idle Detection)

**Description:** As a developer, I want the analyzer to only run during active hours and when the user is not idle so that system resources are not wasted.

**Acceptance Criteria:**

- [ ] Analyzer skips if current time is outside `active_hours_start` - `active_hours_end` (default 8:00 - 23:00)
- [ ] Analyzer skips if last observation timestamp is older than `max_idle_seconds` (default 1800 = 30 min)
- [ ] Both thresholds are configurable via config
- [ ] Unit tests verify skip logic for both conditions

---

#### US-031: Passive Confidence Decay

**Description:** As a developer, I want instinct confidence to decay passively over time so that stale instincts lose relevance.

**Acceptance Criteria:**

- [ ] On each analysis run, the analyzer applies -0.02 per week since `updated_at` for each instinct
- [ ] Decay is applied before feedback adjustments
- [ ] Instincts that drop below 0.1 are flagged for removal
- [ ] `updated_at` is set to current time when any change is made to an instinct
- [ ] Unit tests verify decay calculation and flagging

---

#### US-032: Extension Entry Point Wiring

**Description:** As a developer, I want `index.ts` to wire together all modules - event handlers, commands, timers - so that the extension works end-to-end.

**Acceptance Criteria:**

- [ ] Default export function registers all event handlers: `session_start`, `session_shutdown`, `before_agent_start`, `agent_start`, `agent_end`, `tool_execution_start`, `tool_execution_end`
- [ ] Registers all 6 slash commands
- [ ] Starts analyzer timer on `session_start`, stops on `session_shutdown`
- [ ] Loads config on `session_start`
- [ ] Detects project on `session_start` and stores in module state
- [ ] Ensures storage layout on `session_start`
- [ ] Flushes pending observations on `session_shutdown`
- [ ] Unit tests verify all registrations occur (mock `ExtensionAPI`)

---

#### US-033: Error Handling and Logging

**Description:** As a developer, I want all modules to handle errors gracefully with logging so that failures in the learning system never crash the main Pi session.

**Acceptance Criteria:**

- [ ] All event handlers wrap their body in try/catch
- [ ] Errors are logged to `projects/<id>/analyzer.log` with timestamp and context
- [ ] Observer errors do not propagate to Pi (silently log and continue)
- [ ] Analyzer subprocess failures are logged with stderr output
- [ ] Config loading errors fall back to defaults with a warning
- [ ] Unit tests verify error paths do not throw

---

## 4. Functional Requirements

- FR-1: The system must capture `tool_execution_start`, `tool_execution_end`, `agent_start` (via `before_agent_start` for prompt text), and `agent_end` events as observations
- FR-2: The system must write observations as append-only JSONL to project-scoped files
- FR-3: The system must scrub secrets from observation input/output before writing to disk
- FR-4: The system must spawn a Pi CLI subprocess (`pi -p --mode json --model claude-haiku-4-5`) for background analysis
- FR-5: The system must run analysis every 5 minutes (configurable) when sufficient observations exist
- FR-6: The system must create and update instinct files in YAML-frontmatter markdown format
- FR-7: The system must inject high-confidence instincts into the system prompt via `before_agent_start`
- FR-8: The system must tag observations with active instinct IDs for feedback analysis
- FR-9: The system must adjust instinct confidence based on feedback outcomes: +0.05 confirmed, -0.15 contradicted
- FR-10: The system must apply passive confidence decay of -0.02 per inactive week
- FR-11: The system must flag instincts for removal when confidence drops below 0.1
- FR-12: The system must provide slash commands: `/instinct-status`, `/instinct-export`, `/instinct-import`, `/instinct-promote`, `/instinct-evolve`, `/instinct-projects`
- FR-13: The system must detect projects via git remote URL hashing with path and global fallbacks
- FR-14: The system must archive observation files exceeding 10MB and purge archives older than 30 days
- FR-15: The system must prevent self-observation (skip recording when analyzer is running)
- FR-16: The system must kill the analyzer subprocess on timeout (120s) and session shutdown
- FR-17: The system must validate instinct IDs (kebab-case) and file paths (no traversal)

## 5. Non-Goals (Out of Scope)

- No web UI or dashboard for viewing instincts
- No multi-user or team-sharing features (beyond manual export/import)
- No real-time streaming of instinct changes to the user
- No automatic deletion of instincts (flagging only; user reviews via `/instinct-status`)
- No custom model selection for the analyzer beyond Haiku (configured, not user-selectable per run)
- No observation of non-Pi tools or external processes
- No instinct versioning or history (only current state stored)

## 6. Design Considerations

- **Pi Extension API**: Use `pi.on()` for events, `pi.registerCommand()` for commands, `pi.exec()` for git and shell commands. Extension receives `ExtensionAPI` as the sole parameter.
- **Event names**: Use `tool_execution_start`/`tool_execution_end` (not `tool_call`/`tool_result`) for observation since they provide `toolCallId`, `toolName`, `args`/`result`, and `isError`.
- **User prompt capture**: Use `before_agent_start` (provides `event.prompt`) rather than `agent_start` (which has no prompt text).
- **System prompt injection**: `before_agent_start` handler returns `{ systemPrompt: modified }` to chain with other extensions.
- **Subprocess pattern**: Follows the same pattern as Pi's subagent extension - `spawn("pi", [...args])` with JSON event stream parsing on stdout.
- **No npm dependencies**: All functionality uses Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`) and Pi peer dependencies.

## 7. Technical Considerations

- **Process isolation**: Analyzer runs as a separate process. A crash or timeout cannot affect the main Pi session.
- **Credential reuse**: The subprocess inherits Pi's OAuth credentials from `~/.pi/agent/auth.json` automatically. No separate API key needed.
- **File locking**: JSONL append is generally safe on single-writer systems, but the observer should use `fs.appendFile` (atomic at the OS level for small writes) rather than open-write-close.
- **Memory**: Instincts are loaded from disk on each `before_agent_start`. With the default cap of 20, this is negligible. No in-memory instinct cache is maintained between turns.
- **TypeBox**: Use `@sinclair/typebox` for any tool parameter schemas (it is a peer dependency). Use it for config validation if needed.

## 8. Success Metrics

- Extension loads without errors in Pi
- Observations are recorded for all tool calls and user prompts in a session
- After 20+ observations, the analyzer runs and creates at least one instinct file
- Instincts with confidence >= 0.5 appear in the system prompt on subsequent prompts
- Feedback loop works: an instinct's confidence changes after sessions where it was active
- All 6 slash commands execute without errors
- No secrets appear in observation files (scrubbing works)
- Analyzer subprocess never outlives its 120-second timeout

## 9. Open Questions

- Should the extension provide a UI notification when a new instinct is created? (Spec mentions it in Phase 6 polish but does not detail the UX)
- Should there be a way to manually create instincts (e.g., `/instinct-add`)? The spec only covers auto-discovery.
- How should the extension behave when Pi is running in print mode (`-p`) or RPC mode? The observer could still record, but UI commands would be limited.
- Should the `instinct-evolve` command actually use Haiku to generate clustering suggestions, or use a heuristic approach? The spec says "cluster related instincts" but doesn't specify the mechanism.
