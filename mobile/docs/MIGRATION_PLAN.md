# Migration Plan

## Phase 1 - Scaffold

- Create monorepo root.
- Add placeholders for `android/`, `ios/`, and `shared/`.
- Keep current Android repo untouched and working.

## Phase 2 - Shared Surface Definition

- Identify Android WebView JS that is platform-agnostic.
- Move that JS into `shared/js/`.
- Keep Android wrappers thin and local.

## Phase 3 - Android Migration

- Move Android project into `android/` only after shared boundaries are clear.
- Fix Gradle paths and CI after the move, not before.
- Verify local build/install after the move.

## Phase 4 - iOS Bootstrap

- Create Xcode project under `ios/`.
- Load shared JS from `shared/js/`.
- Rebuild native wrappers for:
  - `WKWebView`
  - cookie handling
  - bridge callbacks

## Phase 5 - Parity Work

- Compare Android and iOS behavior slot by slot.
- Keep backend contracts identical where possible.
- Only share logic that actually reduces duplicated maintenance.

