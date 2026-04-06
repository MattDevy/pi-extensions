# pi-continuous-learning

A Pi extension that observes coding sessions, records events, and distills patterns into reusable "instincts" with confidence scoring, project scoping, and closed-loop feedback validation. Background analysis runs as a standalone script via the Pi SDK.

## Commands

After ANY code change, run:

```bash
npm run check
```

Individual commands (from repo root):

```bash
npm test -w packages/pi-continuous-learning              # run all tests for this package
npm test -w packages/pi-continuous-learning -- src/foo.test.ts  # single file
npm run typecheck                                        # type-check
npm run lint                                             # ESLint
npm run build                                            # compile to dist/
```

Or from within `packages/pi-continuous-learning/`:

```bash
npm test                        # run all tests
npm test -- src/foo.test.ts     # single file
npm run typecheck               # type-check
npm run lint                    # ESLint
npm run build                   # compile to dist/
```

## Conventions

- This is a Pi extension - use Pi SDK APIs (extension events, slash commands, registerTool)
- Use vitest for testing
- Use strict TypeScript (`strict: true`)
- Keep files under 400 lines, functions under 50 lines
- Use TypeBox for runtime validation at boundaries (it is a peer dependency)
- Use StringEnum from `@mariozechner/pi-ai` for string enums in tool schemas (not Type.Union/Type.Literal)
- No hardcoded values - use constants in `config.ts`
- Prefer immutability - create new objects, never mutate existing ones

## Directory Structure

```text
packages/pi-continuous-learning/
  package.json              # pi-package manifest
  src/
    index.ts                # Extension entry point (default export)
    types.ts                # Shared type definitions
    config.ts               # Configuration constants and types
    project.ts              # Project detection (git remote hash)
    storage.ts              # Storage paths and directory layout
    observations.ts         # JSONL append, archive, cleanup, count
    observer-guard.ts       # Skip observations for internal paths
    scrubber.ts             # Secret redaction
    tool-observer.ts        # tool_execution_start/end handlers
    prompt-observer.ts      # before_agent_start/agent_end handlers
    instinct-parser.ts      # YAML frontmatter parse/serialize
    instinct-store.ts       # Instinct CRUD (load, save, list)
    instinct-loader.ts      # Filter + sort + cap instincts for injection
    instinct-injector.ts    # System prompt injection
    instinct-tools.ts       # LLM tool definitions (list/read/write/delete/merge)
    instinct-contradiction.ts # Contradiction detection (opposing actions)
    instinct-validator.ts   # Field validation + Jaccard similarity dedup
    instinct-decay.ts       # Passive confidence decay
    instinct-cleanup.ts     # Auto-cleanup rules (flagged, TTL, cap enforcement)
    confidence.ts           # Pure confidence math
    active-instincts.ts     # Shared state for injected instinct IDs
    agents-md.ts            # AGENTS.md file reader
    error-logger.ts         # Structured logging
    analysis-event-log.ts   # Append-only event log for analyzer -> extension notification
    analysis-notification.ts # Extension-side notification check on before_agent_start
    instinct-status.ts      # /instinct-status command
    instinct-evolve.ts      # /instinct-evolve command (LLM-powered)
    instinct-export.ts      # /instinct-export command
    instinct-graduate.ts    # /instinct-graduate command (graduation pipeline)
    instinct-dream.ts       # /instinct-dream command (holistic consolidation)
    instinct-import.ts      # /instinct-import command
    instinct-promote.ts     # /instinct-promote command
    instinct-projects.ts    # /instinct-projects command
    consolidation.ts        # Consolidation gate logic, session counting, meta persistence
    graduation.ts           # Pure graduation logic (maturity, TTL, candidates)
    skill-scaffold.ts       # Skill scaffolding from instinct clusters
    command-scaffold.ts     # Command scaffolding from instinct clusters
    observation-signal.ts   # Low-signal batch scoring (early exit for analyzer)
    prompts/
      evolve-prompt.ts                  # Prompt template for /instinct-evolve
      dream-prompt.ts                   # Prompt template for /instinct-dream
      consolidate-system.ts             # System prompt for automated consolidation
      consolidate-user.ts               # User prompt builder for consolidation
      analyzer-user.ts                  # User prompt builder (legacy agentic analyzer)
      analyzer-system-single-shot.ts    # System prompt for single-shot analyzer
      analyzer-user-single-shot.ts      # User prompt builder for single-shot analyzer
    cli/
      analyze.ts            # Standalone analyzer script (run via cron)
      analyze-logger.ts     # Structured JSON logger for analyzer runs
      analyze-prompt.ts     # System prompt (legacy agentic analyzer)
      analyze-single-shot.ts  # Single-shot core: parseChanges, buildInstinctFromChange, formatInstinctsCompact, estimateTokens
  docs/
    internals.md            # Internal architecture reference
    specification.md        # Original design specification
```

## Documentation

After any code change, update relevant docs before committing:

- `docs/internals.md` — update when changing architecture, data flow, config defaults, module responsibilities, or file formats
- `docs/specification.md` — update only when changing fundamental design decisions or data models
- `AGENTS.md` directory structure — update when adding or removing source files

## Testing

- Use vitest as the test runner
- Place test files alongside source as `*.test.ts`
- Use `tmp_path`-style temporary directories for file system tests
- Mock Pi SDK interfaces for unit tests
