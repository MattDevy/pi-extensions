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

When invoked, `/simplify` detects changed files and line ranges (via `git diff`) and instructs the agent to review only those changed lines with these principles:

- **Preserve functionality**: never change what the code does
- **Apply project standards**: follow conventions from CLAUDE.md / AGENTS.md
- **Enhance clarity**: reduce complexity, eliminate redundancy, improve naming
- **Maintain balance**: avoid over-simplification

The agent may read surrounding code for context, but edits stay within the changed line ranges. Newly added files are reviewed in full. It applies improvements one file at a time, runs tests to verify nothing breaks, and summarises the changes.

## Agent-callable tool

The extension also registers a `simplify` tool, so an agent can invoke simplification through its tool interface when the user or project instructions ask for it (for example, as a step in an implement → test → simplify → review workflow), without the user typing `/simplify`.

The tool accepts the same scope options as the command:

| Parameter | Type | Default | Equivalent command flag |
| --- | --- | --- | --- |
| `files` | `string[]` | detect via `git diff` | `/simplify src/foo.ts` |
| `ref` | `string` | `HEAD` | `--ref=<ref>` |
| `staged` | `boolean` | `false` | `--staged` |

It returns the changed-file/line scope and the same simplification instructions that `/simplify` sends, directly in the tool result. When no changed files are detected, it returns the same "No changed files found" message as `/simplify` instead of instructions (`details.found` is `false`).

**Calling the tool is not the same as completing simplification.** The tool only returns scope and instructions; it does not edit files. The agent must apply any warranted improvements and run the relevant checks before moving on to the next quality gate.

Example instruction for `AGENTS.md`:

```markdown
After implementing and testing a change, call the `simplify` tool, apply its
instructions, and re-run the relevant checks before the final review.
```

## License

MIT
