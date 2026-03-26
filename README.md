# pi-continuous-learning

A [Pi](https://github.com/nicholasgasior/pi-coding-agent) extension that observes your coding sessions, records events, and uses a background Haiku process to distill observations into reusable "instincts" - atomic learned behaviors with confidence scoring, project scoping, and closed-loop feedback validation.

Inspired by [everything-claude-code/continuous-learning-v2](https://github.com/nicholasb/everything-claude-code), reimplemented as a native Pi extension in TypeScript.

## How It Works

```
Pi Session
  |  Extension events (tool_call, tool_result, agent_end, ...)
  v
Observation Collector  -->  observations.jsonl (per project)
  |
  |  Every 5 minutes (background)
  v
Analyzer (Haiku subprocess via `pi -p`)
  |  Reads observations, detects patterns,
  |  validates existing instincts via feedback loop
  v
Instinct Files (.md with YAML frontmatter)
  |
  |  before_agent_start event
  v
System Prompt Injection  -->  high-confidence instincts appended to prompt
  |
  |  Records which instincts were active
  v
Feedback Loop  -->  confirms, contradicts, or ignores injected instincts
```

**The key idea:** the extension watches what you do, learns patterns, injects relevant instincts into future sessions, then validates whether those instincts actually helped - adjusting confidence based on real outcomes rather than observation count alone.

## Installation

```bash
pi install pi-continuous-learning
```

Or install from a local clone:

```bash
cd pi-continuous-learning
pi install .
```

### Requirements

- [Pi](https://github.com/nicholasgasior/pi-coding-agent) >= 0.62.0
- An active Claude subscription (the background analyzer uses Haiku via your existing Pi credentials - no separate API key needed)

## Usage

Once installed, the extension runs automatically. No configuration required.

### What happens in the background

1. **Observes** - captures tool calls, user prompts, errors, and outcomes via Pi extension events
2. **Records** - writes observations to project-scoped JSONL files under `~/.pi/continuous-learning/`
3. **Analyzes** - every 5 minutes, spawns a background Haiku subprocess to detect patterns
4. **Learns** - creates/updates instinct files with confidence scoring and evidence
5. **Injects** - appends high-confidence instincts to your system prompt each turn
6. **Validates** - tracks whether injected instincts align with actual behavior, adjusting confidence accordingly

### Slash Commands

| Command | Description |
|---------|-------------|
| `/instinct-status` | Show all instincts grouped by domain with confidence scores and feedback stats |
| `/instinct-evolve` | Suggest instinct consolidations, promotions, and higher-order constructs |
| `/instinct-export` | Export instincts to a JSON file (filterable by scope/domain) |
| `/instinct-import <path>` | Import instincts from a JSON file |
| `/instinct-promote [id]` | Promote project instincts to global scope |
| `/instinct-projects` | List all known projects and their instinct counts |

### Example instinct file

Instincts are stored as Markdown files with YAML frontmatter:

```yaml
---
id: grep-before-edit
trigger: "when modifying code files"
confidence: 0.7
domain: "workflow"
source: "session-observation"
scope: project
project_id: "a1b2c3d4e5f6"
observation_count: 8
confirmed_count: 5
contradicted_count: 1
inactive_count: 12
---

# Grep Before Edit

## Action
Always search with grep to find relevant context before editing files.

## Evidence
- Observed 8 instances of grep-then-edit workflow
- Confirmed 5 times: agent used grep before edit while instinct was active
- Contradicted 1 time: agent edited without searching first
```

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

## Configuration

Optional. Defaults work out of the box. Override at `~/.pi/continuous-learning/config.json`:

```json
{
  "version": "1.0",
  "observer": {
    "enabled": true,
    "run_interval_minutes": 5,
    "min_observations_to_analyze": 20
  },
  "injector": {
    "enabled": true,
    "min_confidence": 0.5,
    "max_instincts": 20
  },
  "analyzer": {
    "model": "claude-haiku-4-5",
    "timeout_seconds": 120,
    "max_observations_per_analysis": 500
  }
}
```

## Storage

All data stays local on your machine:

```
~/.pi/continuous-learning/
  config.json                   # Optional overrides
  projects.json                 # Project registry
  instincts/personal/           # Global instincts
  projects/<hash>/
    observations.jsonl          # Current observations
    observations.archive/       # Archived (auto-purged after 30 days)
    instincts/personal/         # Project-scoped instincts
    analyzer.log                # Background analyzer log
```

## Privacy & Security

- All data stays on your machine - no external telemetry
- Secrets (API keys, tokens, passwords) are scrubbed from observations before writing to disk
- Only instincts (patterns) can be exported - never raw observations
- The analyzer subprocess reuses your existing Pi/Claude subscription credentials
- No separate API key required

## Development

```bash
# Run tests
npx vitest run

# Lint
npx eslint src/

# Type check
npx tsc --noEmit

# All checks
npx vitest run && npx eslint src/ && npx tsc --noEmit
```

## License

MIT
