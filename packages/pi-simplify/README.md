# pi-simplify

[![omp status](https://omppackages.com/badge/pi-simplify.svg)](https://omppackages.com/packages/pi-simplify)

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

When invoked, `/simplify` detects changed files and line ranges (via `git diff`) and instructs the agent to review only those changed lines with these principles:

- **Preserve functionality**: never change what the code does
- **Apply project standards**: follow conventions from CLAUDE.md / AGENTS.md
- **Enhance clarity**: reduce complexity, eliminate redundancy, improve naming
- **Maintain balance**: avoid over-simplification

The agent may read surrounding code for context, but edits stay within the changed line ranges. Newly added files are reviewed in full. It applies improvements one file at a time, runs tests to verify nothing breaks, and summarises the changes.

## License

MIT
