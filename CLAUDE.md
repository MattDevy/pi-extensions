# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                          # run all package tests (workspaces)
npm test -w packages/pi-continuous-learning -- src/foo.test.ts  # single file
npm test -w packages/pi-continuous-learning -- -t "pattern"     # by name pattern
npm run typecheck                 # type-check all packages
npm run lint                      # ESLint on all packages
npm run check                     # tests + lint + typecheck (mirrors CI)
npm run lint:mega                 # run MegaLinter locally (requires Docker)
npm run lint:mega:fix             # run MegaLinter and auto-fix formatting
npm run build                     # compile all packages to dist/
```

## Architecture

This is an npm workspaces monorepo. The `pi-continuous-learning` package lives under `packages/pi-continuous-learning/`. Its entry point (`packages/pi-continuous-learning/src/index.ts`) exports a default function that receives `ExtensionAPI` and registers hooks and commands.

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

All source lives under `packages/pi-continuous-learning/src/`:

- **Observers** (`tool-observer.ts`, `session-observer.ts`, `prompt-observer.ts`) — capture session events and write `observations.jsonl`
- **Instinct store** (`instinct-store.ts`, `instinct-parser.ts`, `instinct-loader.ts`) — CRUD for markdown instinct files (YAML frontmatter + body)
- **Injector** (`instinct-injector.ts`, `active-instincts.ts`) — selects high-confidence instincts and injects them into the system prompt before each agent start
- **Confidence** (`confidence.ts`, `instinct-decay.ts`) — scoring and TTL-based decay
- **CLI analyzer** (`cli/analyze.ts`) — standalone background process with lockfile guard, 5-minute global timeout, structured JSON logging
- **Commands** (`src/commands/`) — slash commands registered with Pi
- **Tools** (`instinct-tools.ts`) — LLM-callable tools for instinct CRUD
- **Prompts** (`prompts/`) — system and user prompts for the LLM analyzer, consolidation, and evolution passes

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

### README conventions

- Installation instructions in package READMEs must use `pi install npm:<package-name>`, not `npm install`. These are Pi extensions installed via the Pi CLI.
- When adding a new package, add it to the **Packages** table in the root `README.md` and the **Repository structure** in `AGENTS.md`.
