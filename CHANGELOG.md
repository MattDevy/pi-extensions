# Changelog

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
