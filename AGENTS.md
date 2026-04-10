# pi-extensions

This is an npm workspaces monorepo. All Pi extensions live under `packages/`. Each package has its own `AGENTS.md` with package-specific conventions and directory structure.

## Repository structure

```text
packages/
  pi-continuous-learning/   # Pi extension: continuous learning via instincts
    src/                    # TypeScript source + tests (*.test.ts alongside source)
    docs/                   # Package documentation (internals.md, specification.md)
    AGENTS.md               # Package-level conventions, directory structure, testing
    CHANGELOG.md            # Release history (managed by release-please)
  pi-red-green/             # Pi extension: TDD enforcement (red-green-refactor)
    src/                    # TypeScript source + tests (*.test.ts alongside source)
    CHANGELOG.md            # Release history (managed by release-please)
```

## Commands (run from repo root)

After ANY code change, run the full check:

```bash
npm run check
```

Individual commands:

```bash
npm test                                                       # run all package tests
npm test -w packages/pi-continuous-learning -- src/foo.test.ts # single file
npm test -w packages/pi-continuous-learning -- -t "pattern"    # by name pattern
npm run typecheck                                              # type-check all packages
npm run lint                                                   # ESLint on all packages
npm run build                                                  # compile all packages to dist/
```

## Working on a specific package

When working inside `packages/pi-continuous-learning`, refer to `packages/pi-continuous-learning/AGENTS.md` for:
- Code conventions specific to that package
- Full directory structure with file descriptions
- Testing approach
- Documentation update guidelines

## README conventions

- Installation instructions in package READMEs must use `pi install npm:<package-name>`, not `npm install`. These are Pi extensions installed via the Pi CLI.

## Adding a new package

1. Create `packages/<name>/src/`
2. Add `packages/<name>/package.json` (follow existing package as template)
3. Add `packages/<name>/tsconfig.json` extending `../../tsconfig.base.json`
4. Add `{ "path": "packages/<name>" }` to root `tsconfig.json` references
5. Add `"packages/<name>": {}` to `release-please-config.json`
6. Add `"packages/<name>": "0.1.0"` to `.release-please-manifest.json`
7. No changes needed to `eslint.config.js`, `.mega-linter.yml`, `ci.yml`, or `publish.yml`
