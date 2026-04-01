# Android

This directory is now the Android home inside `chat-aggregator-mobile`.

Rules:

- During migration, Android remains the first implementation source for mobile features.
- The target state is shared-first: shared logic and shared assets should become the source of truth for both Android and iOS.
- Native Android code should remain only where platform behavior cannot be cleanly shared.

Notes:

- This directory was migrated from `../chat-aggregator-android`.
- The old standalone repo is now a migration source and rollback reference, not the intended long-term home.
- canonical local Android deploy path from the mobile repo root:
  - `./scripts/deploy-android-device.sh`
- do not keep rebuilding ad-hoc `adb install` commands by hand when the root deploy script already knows how to:
  - build the debug APK
  - choose the single connected device
  - install it
  - verify the installed version
  - relaunch the app
