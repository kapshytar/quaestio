# chat-aggregator-mobile

Shared mobile monorepo for the Verity clients:

- `android/`
- `ios/`
- `shared/`
- `docs/`

## Current Status

This repo is now the target mobile workspace.

- iOS work lives here and is actively developed in `ios/`.
- Android is being moved here under `android/`.
- `shared/js` and `shared/contracts` are the shared source of truth for cross-platform WebView/provider behavior.
- The legacy standalone `chat-aggregator-android` repo has been merged into `android/` here; this repo is the single home for iOS + Android.

## Goal

Keep mobile development in one repo where:

- Android lives under `android/`
- iOS lives under `ios/`
- shared JS lives under `shared/js/`
- shared payload/contracts docs live under `shared/contracts/`

## Planned Layout

```text
chat-aggregator-mobile/
├── android/
├── ios/
├── shared/
│   ├── js/
│   └── contracts/
└── docs/
```

## Working Rule

- `Android first during migration`
- `shared first as the target state`
- `native only where necessary`

## Canonical Local Commands

- environment / device sanity check:
  - `./scripts/mobile-doctor.sh`
- iPhone deploy:
  - `./scripts/deploy-ios-device.sh`
- Android deploy:
  - `./scripts/deploy-android-device.sh`
- ingest / DB smoke check:
  - `./scripts/ingest-smoke-check.sh <session_id> [platform_code]`
  - example:
    - `./scripts/ingest-smoke-check.sh 121 IOS`

These are the canonical local device workflows for this repo. Prefer them over one-off manual `xcodebuild install`, ad-hoc `devicectl` sequences, or manually reconstructed `adb install` flows.

## Current Migration Direction

1. Keep the migrated Android project in `android/` as the mobile Android home.
2. Keep shared provider DOM logic in `shared/js/`.
3. Keep shared payload/config/contracts in `shared/contracts/`.
4. Let iOS and Android wrap shared logic only where platform-native behavior is required.

## License

Apache License 2.0 — see [LICENSE](LICENSE). Forks and redistributions must
retain the attribution in [NOTICE](NOTICE) (Apache-2.0 §4(d)).
