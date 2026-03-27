# Changelog

## [0.8.0](https://github.com/MattDevy/pi-continuous-learning/compare/pi-continuous-learning-v0.7.0...pi-continuous-learning-v0.8.0) (2026-03-27)


### Features

* Add analysis event log and user notification on instinct changes ([#32](https://github.com/MattDevy/pi-continuous-learning/issues/32)) ([04228d3](https://github.com/MattDevy/pi-continuous-learning/commit/04228d3ed9f575dbd4417e4910adddc18c591cff))
* Reduce analyzer prompt cost ([#21](https://github.com/MattDevy/pi-continuous-learning/issues/21)) ([#29](https://github.com/MattDevy/pi-continuous-learning/issues/29)) ([42048d8](https://github.com/MattDevy/pi-continuous-learning/commit/42048d8b8aea0923aad75b59e077564bd321d769))


### Bug Fixes

* Reduce confirmation bias with session dedup, baseline filtering, and diminishing returns ([#31](https://github.com/MattDevy/pi-continuous-learning/issues/31)) ([c75aeff](https://github.com/MattDevy/pi-continuous-learning/commit/c75aeffd370801fb7d44ed6923fe0eedcf5a54a6))

## [0.7.0](https://github.com/MattDevy/pi-continuous-learning/compare/pi-continuous-learning-v0.6.0...pi-continuous-learning-v0.7.0) (2026-03-27)


### Features

* Add instinct graduation pipeline with AGENTS.md, skill, and command targets ([#26](https://github.com/MattDevy/pi-continuous-learning/issues/26)) ([9057fff](https://github.com/MattDevy/pi-continuous-learning/commit/9057fff9820e734ad6b000e18866ae4bd8e85d68))
* Instinct quality validation, Jaccard dedup, and analyzer quality tiers ([#28](https://github.com/MattDevy/pi-continuous-learning/issues/28)) ([70acdda](https://github.com/MattDevy/pi-continuous-learning/commit/70acdda806b830ac3918ef52ce4f770b770827fd))
* Instinct volume control - caps, auto-cleanup, and faster decay ([#27](https://github.com/MattDevy/pi-continuous-learning/issues/27)) ([8cdee28](https://github.com/MattDevy/pi-continuous-learning/commit/8cdee28669cc0ca7fc903629590a724630e8ccbe))


### Bug Fixes

* Reject instincts with undefined/empty/short action or trigger fields ([#24](https://github.com/MattDevy/pi-continuous-learning/issues/24)) ([6016a8c](https://github.com/MattDevy/pi-continuous-learning/commit/6016a8cb059576ed68c39d275bdaec1ea68d2788))

## [0.6.0](https://github.com/MattDevy/pi-continuous-learning/compare/pi-continuous-learning-v0.5.1...pi-continuous-learning-v0.6.0) (2026-03-27)


### Features

* Add observation preprocessor to strip low-signal events ([19ed1e5](https://github.com/MattDevy/pi-continuous-learning/commit/19ed1e513b754958d303e6ba5d6697726f54a676))
* Add single-shot analyzer core (parseChanges, buildInstinctFromChange, runSingleShot) ([19ed1e5](https://github.com/MattDevy/pi-continuous-learning/commit/19ed1e513b754958d303e6ba5d6697726f54a676))
* Add single-shot analyzer system prompt with JSON output format ([19ed1e5](https://github.com/MattDevy/pi-continuous-learning/commit/19ed1e513b754958d303e6ba5d6697726f54a676))
* Add single-shot user prompt builder with inline instinct context ([19ed1e5](https://github.com/MattDevy/pi-continuous-learning/commit/19ed1e513b754958d303e6ba5d6697726f54a676))
* Preprocess observations in tailObservationsSince (strip low-signal events before analysis) ([19ed1e5](https://github.com/MattDevy/pi-continuous-learning/commit/19ed1e513b754958d303e6ba5d6697726f54a676))
* Replace agentic analyzer with single-shot + observation preprocessing (-88% cost) ([#14](https://github.com/MattDevy/pi-continuous-learning/issues/14)) ([19ed1e5](https://github.com/MattDevy/pi-continuous-learning/commit/19ed1e513b754958d303e6ba5d6697726f54a676))

## [0.5.1](https://github.com/MattDevy/pi-continuous-learning/compare/pi-continuous-learning-v0.5.0...pi-continuous-learning-v0.5.1) (2026-03-27)


### Bug Fixes

* Scope-aware delete and merge for instinct_delete and instinct_merge ([#12](https://github.com/MattDevy/pi-continuous-learning/issues/12)) ([57137a8](https://github.com/MattDevy/pi-continuous-learning/commit/57137a864a2865e5e5ed58f461858e90d9bfbbe4))

## [0.5.0](https://github.com/MattDevy/pi-continuous-learning/compare/pi-continuous-learning-v0.4.0...pi-continuous-learning-v0.5.0) (2026-03-27)


### Features

* Add structured JSON logging to analyzer CLI ([#9](https://github.com/MattDevy/pi-continuous-learning/issues/9)) ([59917b8](https://github.com/MattDevy/pi-continuous-learning/commit/59917b8fade9895e85756a4c950e5803a21c2682))

## [0.4.0](https://github.com/MattDevy/pi-continuous-learning/compare/pi-continuous-learning-v0.3.0...pi-continuous-learning-v0.4.0) (2026-03-27)


### Features

* Add npm publish workflow on release published ([2bc242a](https://github.com/MattDevy/pi-continuous-learning/commit/2bc242a368c89982e840d3ced6f7a993c24f8b64))
* Add npm publish workflow on release published ([67c6074](https://github.com/MattDevy/pi-continuous-learning/commit/67c60748625eabe052cff50c3ee09c19a229ae41))
* Add turn, bash, compact, and model observation hooks ([#8](https://github.com/MattDevy/pi-continuous-learning/issues/8)) ([d7bd51a](https://github.com/MattDevy/pi-continuous-learning/commit/d7bd51a88ac14ca5d6d47b19f4859eeecedc0ae8))
