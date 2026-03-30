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
- The sibling repo `../chat-aggregator-android` is now a migration source and rollback reference, not the intended long-term home.

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

## Current Migration Direction

1. Keep the migrated Android project in `android/` as the mobile Android home.
2. Keep shared provider DOM logic in `shared/js/`.
3. Keep shared payload/config/contracts in `shared/contracts/`.
4. Let iOS and Android wrap shared logic only where platform-native behavior is required.
