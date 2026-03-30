# Changelog

All notable changes to this repo are documented here.

Versioning policy:
- mobile follows the shared Verity client `1.x.y` family
- during the Android/iOS migration period, iOS and Android version sources may still live in different files
- every code change in this repo increments `y`
- every commit/push milestone in this repo increments `x`
- after incrementing `x`, `y` resets to `0`
- meaningful mobile milestones must still be recorded here even before version-source unification is complete

## [Unreleased] - 2026-03-30

### Added
- `chat-aggregator-mobile` now has its own repo-level changelog and is treated as the active history surface for mobile work.
- First shared merge catalog added under `shared/contracts/mergeConfig.json`.
- iOS merge now has a real provider-backed API path instead of only a placeholder shell.
- iOS clarification/history flow now follows the Android merge conversation model more closely.
- iOS now mirrors Android's preinstalled `DeepSeek` key path with the same “preinstalled vs custom” merge-key behavior.

### Changed
- Android project is now migrated into `chat-aggregator-mobile/android/` as part of the intended mobile monorepo structure.
- Mobile docs now explicitly describe the target architecture:
  - Verity architecture first
  - Android first only during migration
  - shared first as the target state
  - native only where necessary
- iOS auth/browser-like behavior was hardened with shared session state, popup handling, diagnostics, and provider login experiments.
- iOS `Merge` now follows Android more closely for first-run defaults and aggregation behavior:
  - `DeepSeek API` is now the default provider because it has the preinstalled key path
  - `DeepSeek` no longer shows a cluttered config by default
  - merge aggregation now polls for replies before giving up instead of doing one naive scrape pass
  - iOS merge screen now exposes Android-like aggregation status refresh/collect controls
- merge provider visibility and aggregation retry policy now live in the shared `mergeConfig.json` contract and are consumed by both mobile clients
- Android and iOS now use the same mobile repo version milestone `1.104.0` for this merge-and-streaming pass
- SSE parsing now lives in shared `mergeStreamParser.js`, with Android and iOS acting as transport wrappers around the same parser surface
- mobile merge streaming now reads chunk/model extraction rules from shared `streamParserConfig.json` instead of hardcoding SSE parsing behavior separately in Swift and Kotlin

### Fixed
- iOS merge build path is now reproducible from `project.yml` + `xcodegen` instead of depending only on Xcode GUI state.
