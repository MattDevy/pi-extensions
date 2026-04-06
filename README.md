# pi-continuous-learning

A [Pi](https://github.com/nicholasgasior/pi-coding-agent) extension that observes your coding sessions and distills patterns into reusable "instincts" - atomic learned behaviors with confidence scoring, project scoping, and closed-loop feedback validation.

Inspired by [everything-claude-code/continuous-learning-v2](https://github.com/nicholasb/everything-claude-code), reimplemented as a native Pi extension in TypeScript.

## How It Works

```
Pi Session (extension)                     Background analyzer (standalone)
──────────────────────                     ──────────────────────────────────
Extension events                           Runs on a schedule (cron/launchd)
  │                                          │
  v                                          v
Observation Collector                      Reads observations.jsonl per project
  │  writes observations.jsonl               │
  v                                          v
System Prompt Injection                    Haiku LLM analyzes patterns,
  │  injects high-confidence instincts       creates/updates instinct files
  v                                          │
Feedback Loop                              Instinct Files (.md with YAML frontmatter)
  │  records which instincts were active
  v
Confirms, contradicts, or ignores injected instincts
```

**The key idea:** the extension watches what you do, learns patterns, injects relevant instincts into future sessions, then validates whether those instincts actually helped — adjusting confidence based on real outcomes rather than observation count alone.

The analyzer runs as a **separate background process** (not inside your Pi session), so it never causes lag or interference. It processes all your projects in a single pass.

## Installation

```bash
pi install npm:pi-continuous-learning
```

This installs the extension globally and makes the `pi-cl-analyze` CLI available on your PATH.

### Requirements

- [Pi](https://github.com/nicholasgasior/pi-coding-agent) >= 0.62.0
- An LLM provider configured with Pi (subscription or API key — the analyzer defaults to Haiku; see [Configuration](#configuration) to change the model)
- Node.js >= 18

## Usage

Once installed, the extension runs automatically in your Pi sessions — observing events and injecting instincts. No configuration required for the extension itself.

To analyze observations and create/update instincts, you need to run the analyzer separately (see [Background Analyzer](#background-analyzer) below).

### Slash Commands

| Command                   | Description                                                                    |
| ------------------------- | ------------------------------------------------------------------------------ |
| `/instinct-status`        | Show all instincts grouped by domain with confidence scores and feedback stats |
| `/instinct-evolve`        | LLM-powered analysis of instincts: suggests merges, promotions, and cleanup    |
| `/instinct-export`        | Export instincts to a JSON file (filterable by scope/domain)                   |
| `/instinct-import <path>` | Import instincts from a JSON file                                              |
| `/instinct-promote [id]`  | Promote project instincts to global scope                                      |
| `/instinct-graduate`      | Graduate mature instincts to AGENTS.md, skills, or commands                    |
| `/instinct-projects`      | List all known projects and their instinct counts                              |

### LLM Tools

The extension registers tools that the LLM can use during conversation:

| Tool              | Description                                       |
| ----------------- | ------------------------------------------------- |
| `instinct_list`   | List instincts with optional scope/domain filters |
| `instinct_read`   | Read a specific instinct by ID                    |
| `instinct_write`  | Create or update an instinct                      |
| `instinct_delete` | Remove an instinct by ID                          |
| `instinct_merge`  | Merge multiple instincts into one                 |

You can ask Pi things like "show me my instincts", "merge these two instincts", or "delete low-confidence instincts" and it will use these tools.

## Background Analyzer

The analyzer is a standalone CLI that processes observations across all your projects and creates/updates instincts using Haiku. It runs outside of Pi sessions for efficiency — one process handles all projects, regardless of how many Pi sessions you have open.

### Running manually

```bash
pi-cl-analyze
```

The script:

1. Iterates all projects in `~/.pi/continuous-learning/projects.json`
2. Skips projects with no new observations since last analysis
3. Skips projects with fewer than 20 observations (configurable)
4. For eligible projects: runs confidence decay, then uses Haiku to analyze patterns and write instinct files
5. Records a cursor so only new observations are processed on subsequent runs

**Safety features:**

- **Lockfile guard:** Only one instance can run at a time. Subsequent invocations exit immediately with code 0.
- **Global timeout:** The process exits after 5 minutes regardless of progress.
- **Stale lock detection:** If a previous run crashed, the lockfile is automatically cleaned up after 10 minutes or if the owning process is no longer alive.

### Logging

The analyzer writes structured JSON logs to `~/.pi/continuous-learning/analyzer.log` (configurable via `log_path` in config). Each run logs:

- **Run timing** - total duration and per-project duration
- **Token usage** - input, output, cache read/write, total
- **Cost** - USD cost per project and total
- **Instinct changes** - counts of created, updated, and deleted instincts
- **Skip reasons** - why projects were skipped (no new observations, below threshold, etc.)
- **Errors** - full error details with stack traces

Each log line is a JSON object, making it easy to parse with `jq`:

```bash
# View recent run summaries
cat ~/.pi/continuous-learning/analyzer.log | jq 'select(.event == "run_complete")'

# Check total cost over time
cat ~/.pi/continuous-learning/analyzer.log | jq 'select(.event == "run_complete") | .total_cost_usd'

# See which projects were processed
cat ~/.pi/continuous-learning/analyzer.log | jq 'select(.event == "project_complete") | {project: .project_name, duration_s: (.duration_ms/1000), cost: .cost_usd}'
```

The log file auto-rotates at 10 MB (old content moved to `analyzer.log.old`). When the log file is not writable, output falls back to stderr.

### Setting up a schedule (macOS)

The recommended way to run the analyzer on a recurring schedule on macOS is with `launchd`, which persists across reboots and handles log rotation.

#### 1. Find the binary path

```bash
which pi-cl-analyze
```

This should print something like `/opt/homebrew/bin/pi-cl-analyze`. Use this path in the plist below.

#### 2. Create the plist file

```bash
cat > ~/Library/LaunchAgents/com.pi-continuous-learning.analyze.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pi-continuous-learning.analyze</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which pi-cl-analyze)</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>StandardOutPath</key>
    <string>/tmp/pi-cl-analyze-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pi-cl-analyze-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(echo $PATH)</string>
    </dict>
</dict>
</plist>
EOF
```

> **Note:** The `$(which pi-cl-analyze)` and `$(echo $PATH)` substitutions are evaluated when you run the `cat` command, so the plist will contain the resolved absolute paths from your current shell.

#### 3. Load the schedule

```bash
launchctl load ~/Library/LaunchAgents/com.pi-continuous-learning.analyze.plist
```

The analyzer will now run every 5 minutes (300 seconds) in the background, starting on login. It's safe for overlapping triggers — the lockfile guard ensures only one instance runs.

#### 4. Verify it's running

```bash
# Check if the job is loaded
launchctl list | grep pi-continuous-learning

# View recent log entries (structured JSON)
tail -5 ~/.pi/continuous-learning/analyzer.log | jq .

# View stderr output (fallback only)
tail -20 /tmp/pi-cl-analyze-stderr.log
```

#### Disabling the schedule

```bash
# Stop and unload (persists across reboots — the job will not restart)
launchctl unload ~/Library/LaunchAgents/com.pi-continuous-learning.analyze.plist

# Optionally remove the plist file entirely
rm ~/Library/LaunchAgents/com.pi-continuous-learning.analyze.plist
```

#### Temporarily pausing

```bash
# Disable (keeps the plist but prevents it from running)
launchctl unload ~/Library/LaunchAgents/com.pi-continuous-learning.analyze.plist

# Re-enable later
launchctl load ~/Library/LaunchAgents/com.pi-continuous-learning.analyze.plist
```

### Setting up a schedule (Linux/other)

Use cron:

```bash
# Edit crontab
crontab -e

# Add this line (runs every 5 minutes):
*/5 * * * * pi-cl-analyze 2>> /tmp/pi-cl-analyze-stderr.log
```

To disable, remove the line from `crontab -e`.

## Example instinct file

Instincts are stored as Markdown files with YAML frontmatter:

```yaml
---
id: grep-before-edit
title: Grep Before Edit
trigger: "when modifying code files"
confidence: 0.7
domain: "workflow"
source: "personal"
scope: project
project_id: "a1b2c3d4e5f6"
project_name: "my-project"
observation_count: 8
confirmed_count: 5
contradicted_count: 1
inactive_count: 12
---
Always search with grep to find relevant context before editing files.
```

Graduated instincts include additional fields:

```yaml
---
id: grep-before-edit
# ...other fields...
graduated_to: agents-md
graduated_at: "2026-03-27T12:00:00.000Z"
---
```

## Instinct Quality Control

Every instinct write (from the LLM tools or the background analyzer) is validated and deduplicated before being saved.

### Content Validation

| Rule             | Details                                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-empty fields | `action` and `trigger` cannot be `undefined`, `null`, `"null"`, `"none"`, or empty                                                                                                                                                                              |
| Minimum length   | Both fields must be >= 10 characters                                                                                                                                                                                                                            |
| Known domain     | `domain` must be in the known set: `git`, `testing`, `debugging`, `workflow`, `typescript`, `javascript`, `python`, `go`, `css`, `design`, `security`, `performance`, `documentation`, `react`, `node`, `database`, `api`, `devops`, `architecture`, or `other` |
| Verb heuristic   | `action` should start with an imperative verb - a warning is logged but the write is not rejected                                                                                                                                                               |

### Semantic Deduplication

Before a new instinct is created, a Jaccard similarity check runs against all existing instincts. Tokenize `trigger + action`, compute `|intersection| / |union|`, and block the write if any existing instinct scores >= 0.6.

This prevents near-duplicate instincts from accumulating. When a similar instinct exists, the LLM is told to update the existing one instead.

### Analyzer Quality Tiers

The background analyzer is instructed to classify patterns before recording them:

- **Project Conventions** (Tier 1): Project-specific patterns like "use Result<T,E> for errors in this codebase" → record as project-scoped instinct
- **Workflow Patterns** (Tier 2): Universal multi-step workflows → record as global-scoped instinct
- **Generic Agent Behavior** (Tier 3): Read-before-edit, clarify-before-implement, check-errors-after-tool-calls → **skip entirely**, these are fundamental behaviors not learned patterns

The analyzer also checks AGENTS.md content before creating instincts - if a pattern is already covered by AGENTS.md, it is skipped.

## Confidence Scoring

Confidence comes from two sources:

**Discovery** (initial, based on observation count):

- 1-2 observations: 0.3 (tentative)
- 3-5: 0.5 (moderate)
- 6-10: 0.7 (strong)
- 11+: 0.85 (very strong)

**Feedback** (ongoing, based on real outcomes):

- Confirmed (behavior aligned with instinct): +0.05
- Contradicted (behavior went against instinct): -0.15
- Inactive (instinct irrelevant to the turn): no change
- Passive decay: -0.02 per week without observations
- Range: 0.1 min, 0.9 max. Below 0.1 = flagged for removal.

This means an instinct observed 20 times but consistently contradicted in practice will lose confidence. Frequency alone doesn't equal correctness.

## Instinct Graduation

Instincts are designed to be short-lived - they should graduate into permanent knowledge within a few weeks. The graduation pipeline (`/instinct-graduate`) handles this lifecycle:

```
Observation -> Instinct (days) -> AGENTS.md / Skill / Command (1-2 weeks)
```

### Graduation Targets

| Target        | When                                     | What happens                                                      |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| **AGENTS.md** | Single mature instinct                   | Appended as a guideline entry to your project or global AGENTS.md |
| **Skill**     | 3+ related instincts in the same domain  | Scaffolded into a `SKILL.md` file                                 |
| **Command**   | 3+ workflow instincts in the same domain | Scaffolded into a slash command specification                     |

### Maturity Criteria

An instinct qualifies for graduation when all of these are met:

- Age >= 7 days
- Confidence >= 0.75
- Confirmed >= 3 times
- Contradicted <= 1 time
- Not a duplicate of existing AGENTS.md content

### TTL Enforcement

Instincts that don't graduate within 28 days are subject to TTL enforcement:

- **Confidence < 0.3**: Deleted outright
- **Confidence >= 0.3**: Aggressively decayed (confidence halved, flagged for removal)

Graduated instincts are tracked with `graduated_to` and `graduated_at` fields so they aren't left as duplicates of the knowledge they graduated into.

## Updating

```bash
pi install npm:pi-continuous-learning
```

Your observations, instincts, and configuration are stored separately in `~/.pi/continuous-learning/` and are preserved across updates.

If you have a launchd schedule set up, no changes needed — the plist points to the binary which npm updates in place.

## Configuration

Optional. Defaults work out of the box. Override at `~/.pi/continuous-learning/config.json`:

```json
{
  "run_interval_minutes": 5,
  "min_observations_to_analyze": 20,
  "min_confidence": 0.5,
  "max_instincts": 20,
  "max_injection_chars": 4000,
  "model": "claude-haiku-4-5",
  "timeout_seconds": 120,
  "active_hours_start": 8,
  "active_hours_end": 23,
  "max_idle_seconds": 1800
}
```

Only include the fields you want to change — missing fields use the defaults above.

| Field                         | Default                                  | Description                                                                            |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `run_interval_minutes`        | 5                                        | How often the analyzer is expected to run (informational, used for decay calculations) |
| `min_observations_to_analyze` | 20                                       | Minimum observations before analysis triggers                                          |
| `min_confidence`              | 0.5                                      | Instincts below this are not injected into prompts                                     |
| `max_instincts`               | 20                                       | Maximum instincts injected per turn                                                    |
| `max_injection_chars`         | 4000                                     | Character budget for the injection block (~1000 tokens)                                |
| `model`                       | `claude-haiku-4-5`                       | Model for the background analyzer (lightweight models recommended to minimize cost)    |
| `timeout_seconds`             | 120                                      | Per-project timeout for the analyzer LLM session                                       |
| `active_hours_start`          | 8                                        | Hour (0-23) at which the active observation window starts                              |
| `active_hours_end`            | 23                                       | Hour (0-23) at which the active observation window ends                                |
| `max_idle_seconds`            | 1800                                     | Seconds of inactivity before a session is considered idle                              |
| `log_path`                    | `~/.pi/continuous-learning/analyzer.log` | Path to the analyzer log file                                                          |

## Storage

All data stays local on your machine:

```
~/.pi/continuous-learning/
  config.json                   # Optional overrides
  projects.json                 # Project registry
  analyze.lock                  # Lockfile (present only while analyzer runs)
  instincts/personal/           # Global instincts
  projects/<hash>/
    project.json                # Project metadata + analysis cursor
    observations.jsonl          # Current observations
    observations.archive/       # Archived (auto-purged after 30 days)
    instincts/personal/         # Project-scoped instincts
```

## Privacy & Security

- All data stays on your machine — no external telemetry
- Secrets (API keys, tokens, passwords) are scrubbed from observations before writing to disk
- Only instincts (patterns) can be exported — never raw observations
- The analyzer uses your existing Pi LLM credentials — no additional keys needed

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck

# Build (compiles to dist/)
npm run build

# All checks
npm run check
```

## License

MIT
