# Contributing

## Development setup

```bash
git clone https://github.com/MattDevy/pi-continuous-learning.git
cd pi-continuous-learning
npm install
```

Node.js >= 18 required.

## Workflow

```bash
npm test                                                        # run all tests
npm test -w packages/pi-continuous-learning -- src/foo.test.ts  # run a single file
npm test -w packages/pi-continuous-learning -- -t "pattern"     # run tests matching a name
npm run typecheck               # type-check without emitting
npm run lint                    # ESLint
npm run check                   # tests + lint + typecheck (mirrors CI)
```

All three checks must pass before submitting a PR. CI runs them automatically.

## Full lint (MegaLinter)

CI also runs [MegaLinter](https://megalinter.io/) which checks YAML/JSON formatting (Prettier), Markdown, shell scripts, spelling, and secret scanning. You can run the same checks locally before pushing — requires [Docker](https://docs.docker.com/get-docker/).

```bash
npm run lint:mega        # lint changed files (matches CI behaviour)
npm run lint:mega:fix    # auto-fix formatting issues
```

With `--fix`, MegaLinter writes formatting changes directly to your files. Review the diff and commit the results.

> `VALIDATE_ALL_CODEBASE` is set to `false` in `.mega-linter.yml`. In CI this means only PR-changed files are linted. Locally, MegaLinter falls back to `git diff` — so staged and modified files are checked.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: correct a bug
docs: update documentation
ci: changes to CI/CD
chore: maintenance tasks
refactor: code change with no behaviour change
test: add or update tests
```

Releases are automated via Release Please, which reads commit messages to generate the changelog and bump the version. A `feat:` triggers a minor bump; `fix:` a patch; `feat!:` or `BREAKING CHANGE:` a major.

## TypeScript notes

- ESM project — imports need `.js` extensions even for `.ts` sources
- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are enabled — array access returns `T | undefined` and optional properties cannot be assigned `undefined` explicitly
- Prefix intentionally unused parameters with `_`
- `console.warn` and `console.error` are allowed; `console.log` and `console.info` are not

## Pull requests

- Keep PRs focused on a single concern
- Add tests for new behaviour — coverage threshold is 80% for branches, functions, lines, and statements
- The existing tests are a good reference for style and structure
