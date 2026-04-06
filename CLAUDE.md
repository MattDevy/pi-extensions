# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                          # run all tests
npm test -- src/foo.test.ts       # run a single test file
npm test -- -t "pattern"          # run tests matching a name pattern
npm run typecheck                 # type-check without emitting
npm run lint                      # ESLint on src/
npm run check                     # tests + lint + typecheck (mirrors CI)
npm run build                     # compile to dist/
```

## Architecture

This is a [Pi](https://github.com/nicholasgasior/pi-coding-agent) extension. The entry point (`src/index.ts`) exports a default function that receives `ExtensionAPI` and registers hooks and commands.

### Data flow

```
Pi session (extension)               Background analyzer (pi-cl-analyze CLI)
──────────────────────               ──────────────────────────────────────
Hooks observe session events    →    Reads observations.jsonl per project
  writes to observations.jsonl       Calls Haiku LLM to find patterns
                                     Creates/updates instinct .md files
Before next agent start         ←
  high-confidence instincts injected into system prompt
  feedback loop records which instincts were active
  confidence adjusted by real outcomes
```

The analyzer runs as a **separate background process** (cron/launchd), never inside a Pi session.

### Key modules

- **Observers** (`tool-observer.ts`, `session-observer.ts`, `prompt-observer.ts`) — capture session events and write `observations.jsonl`
- **Instinct store** (`instinct-store.ts`, `instinct-parser.ts`, `instinct-loader.ts`) — CRUD for markdown instinct files (YAML frontmatter + body)
- **Injector** (`instinct-injector.ts`, `active-instincts.ts`) — selects high-confidence instincts and injects them into the system prompt before each agent start
- **Confidence** (`confidence.ts`, `instinct-decay.ts`) — scoring and TTL-based decay
- **CLI analyzer** (`src/cli/analyze.ts`) — standalone background process with lockfile guard, 5-minute global timeout, structured JSON logging
- **Commands** (`src/commands/`) — slash commands registered with Pi
- **Tools** (`instinct-tools.ts`) — LLM-callable tools for instinct CRUD
- **Prompts** (`src/prompts/`) — system and user prompts for the LLM analyzer, consolidation, and evolution passes

### Storage layout

All runtime data lives under `~/.pi/continuous-learning/`:
- `instincts/` — one `.md` file per instinct (YAML frontmatter + markdown body)
- `projects/<hash>/observations.jsonl` — raw session observations per project
- `analyzer.log` — structured JSON log from background analyzer

### TypeScript notes

- ESM (`"type": "module"`, `moduleResolution: NodeNext`) — imports need explicit `.js` extensions even for `.ts` sources
- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — array access returns `T | undefined`, optional properties cannot be assigned `undefined` explicitly
- Prefix intentionally unused parameters with `_` (ESLint ignores `^_`)
- `console.warn` and `console.error` are allowed; `console.log`/`console.info` are not
