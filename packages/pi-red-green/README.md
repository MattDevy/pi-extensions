# pi-red-green

TDD enforcement for [Pi coding agent](https://github.com/nicepkg/pi) sessions. Forces agents to follow the RED-GREEN-REFACTOR cycle: write failing tests first, implement minimally, then refactor.

## Installation

```bash
pi install npm:pi-red-green
```

## Usage

### Start a TDD session

```
/tdd Add user authentication
```

This enters RED phase. The agent's system prompt is modified to enforce writing failing tests first.

### Check status

```
/tdd-status
```

Shows current phase, task, file history, test results, and staleness.

### End a TDD session

```
/tdd off
```

### Phase cycle

1. **RED**: Write failing tests. Agent is blocked from writing implementation.
2. **GREEN**: Tests are failing as expected. Write the simplest code to pass.
3. **REFACTOR**: Tests pass. Clean up without adding behavior.
4. **COMPLETE**: Cycle done. Start a new task or deactivate.

Phase transitions happen automatically when test runner output is detected (vitest, jest, pytest, go test, cargo test, etc).

## LLM Tools

The extension registers three tools the agent can call:

| Tool | Description |
|------|-------------|
| `tdd_status` | Returns current phase, task, file history, test results |
| `tdd_advance` | Manually advance to next phase (escape hatch) |
| `tdd_reset` | Reset TDD state to idle |

## Configuration

Create `~/.pi/red-green/config.json` to override defaults:

```json
{
  "injection_mode": "active-only",
  "ordering_enforcement": "warn",
  "auto_advance": true,
  "coverage_threshold": 80,
  "coverage_enabled": false,
  "test_file_patterns": {
    "typescript": ["**/*.test.ts", "**/*.spec.ts"],
    "python": ["**/test_*.py", "**/*_test.py"],
    "go": ["**/*_test.go"],
    "rust": ["**/tests/**/*.rs"],
    "java": ["**/*Test.java", "**/*Spec.java"],
    "php": ["**/*Test.php"]
  },
  "test_runner_patterns": [
    "vitest", "jest", "pytest", "go test", "cargo test",
    "phpunit", "mix test", "npm test"
  ]
}
```

### Injection modes

- `active-only` (default): Only inject TDD prompts when `/tdd` is active
- `always`: Inject TDD guidance on every turn, nudge when idle
- `nudge`: Inject gentle "consider writing tests first" reminders
- `off`: No injection

### Ordering enforcement

- `warn` (default): Warn when implementation files are edited before test files
- `strict`: Instruct the agent to delete implementation and start over with tests
- `off`: No enforcement

## Storage

Runtime data lives under `~/.pi/red-green/`:

```
~/.pi/red-green/
  config.json     # User config overrides
  state.json      # Current TDD state (survives session restarts)
  history.jsonl   # Completed TDD cycles
```

## License

MIT
