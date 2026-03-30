# Changelog

All notable changes to this repo are documented here.

Versioning policy:
- mobile follows the shared Verity client `1.x.y` family
- during the Android/iOS migration period, iOS and Android version sources may still live in different files
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

### Fixed
- iOS merge build path is now reproducible from `project.yml` + `xcodegen` instead of depending only on Xcode GUI state.
