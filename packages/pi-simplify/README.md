# pi-simplify

A [Pi](https://github.com/nicholasgasior/pi-coding-agent) extension that reviews recently changed code for clarity, consistency, and maintainability improvements.

## Installation

```bash
pi install npm:pi-simplify
```

## Usage

### Review all uncommitted changes

```
/simplify
```

### Review only staged changes

```
/simplify --staged
```

### Review specific files

```
/simplify src/foo.ts src/bar.ts
```

### Diff against a specific branch

```
/simplify --ref=main
```

## What it does

When invoked, `/simplify` detects changed files (via `git diff`) and instructs the agent to review them with these principles:

- **Preserve functionality**: never change what the code does
- **Apply project standards**: follow conventions from CLAUDE.md / AGENTS.md
- **Enhance clarity**: reduce complexity, eliminate redundancy, improve naming
- **Maintain balance**: avoid over-simplification

The agent reads each file, applies improvements one at a time, runs tests to verify nothing breaks, and summarizes the changes.

## License

MIT
