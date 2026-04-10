# pi-extensions

[![CI](https://github.com/MattDevy/pi-continuous-learning/workflows/CI/badge.svg)](https://github.com/MattDevy/pi-continuous-learning/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A monorepo of [Pi](https://github.com/nicholasgasior/pi-coding-agent) extensions, built and released independently under `packages/`.

## Packages

| Package | Description | npm |
|---|---|---|
| [pi-continuous-learning](packages/pi-continuous-learning) | Observes coding sessions and distils patterns into reusable instincts with confidence scoring and closed-loop feedback | [![npm](https://img.shields.io/npm/v/pi-continuous-learning)](https://www.npmjs.com/package/pi-continuous-learning) |
| [pi-red-green](packages/pi-red-green) | TDD enforcement for agent sessions: RED-GREEN-REFACTOR state machine with phase-specific prompt injection and test run detection | [![npm](https://img.shields.io/npm/v/pi-red-green)](https://www.npmjs.com/package/pi-red-green) |
| [pi-compass](packages/pi-compass) | Codebase navigation: generates structured codemaps and interactive code tours for faster agent onboarding | [![npm](https://img.shields.io/npm/v/pi-compass)](https://www.npmjs.com/package/pi-compass) |
| [pi-simplify](packages/pi-simplify) | Code simplification: reviews recently changed files for clarity, consistency, and maintainability | [![npm](https://img.shields.io/npm/v/pi-simplify)](https://www.npmjs.com/package/pi-simplify) |
| [pi-code-review](packages/pi-code-review) | Automated code review: language-aware review after edits with structured findings | [![npm](https://img.shields.io/npm/v/pi-code-review)](https://www.npmjs.com/package/pi-code-review) |

## Development

```bash
npm install                           # install all workspace dependencies
npm test                              # run all package tests
npm run build                         # compile all packages to dist/
npm run typecheck                     # type-check all packages
npm run lint                          # ESLint across all packages
npm run check                         # tests + lint + typecheck (mirrors CI)
npm run lint:mega                     # run MegaLinter locally (requires Docker)
```

See each package's `README.md` for installation and usage, and `AGENTS.md` for development conventions.
