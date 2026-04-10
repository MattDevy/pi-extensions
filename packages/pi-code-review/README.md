# pi-code-review

A [Pi](https://github.com/nicholasgasior/pi-coding-agent) extension that provides automated, language-aware code review after the agent writes or modifies files.

## Installation

```bash
pi install npm:pi-code-review
```

## Features

### Automatic review (zero cost)

After each turn where the agent edits files, a language-aware review checklist is injected into the system prompt. The agent self-reviews before proceeding, catching type safety issues, error handling gaps, security concerns, and naming problems.

Supports: TypeScript, Python, Go, Rust, Java, PHP.

### On-demand review (`/review`)

Run a thorough code review with structured findings:

```
/review                    # review all uncommitted changes
/review --staged           # only staged changes
/review --ref=main         # diff against main
/review src/foo.ts         # specific files
```

When an Anthropic API key is available, `/review` uses a direct Haiku call for structured output with severity-leveled findings (CRITICAL / HIGH / MEDIUM / INFO). Without an API key, it falls back to a prompt-based review via the session agent.

## How it works

1. **Edit tracking**: hooks into `tool_execution_end` to collect files modified by Write/Edit tools during each turn
2. **Turn batching**: at `turn_end`, snapshots the accumulated edits (no per-edit overhead)
3. **Prompt injection**: at `before_agent_start`, injects a brief language-specific review checklist into the system prompt
4. **On-demand**: `/review` reads file contents, calls Haiku for structured analysis, and formats findings with severity, line numbers, and suggestions

## License

MIT
