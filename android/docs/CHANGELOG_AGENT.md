# Agent Changelog

Last updated: 2026-02-18

## Session Summary (2026-03-05)

- Android sessions dialog upgraded to two-line rows:
  - title: `S<sessionId> + name`
  - subtitle: date/time in small gray text
- Added long-tap delete in sessions list (with confirmation).
- Fixed timestamp parsing from Supabase session bridge payloads:
  - now supports both `updatedAt/createdAt` and `updated_at/created_at`.
  - fallback parser handles timezone/fractional ISO variants.
- Fixed sessions order stability:
  - newest-first ordering now uses parsed backend timestamps.
- Desktop parity fix:
  - Android now keeps all prompts in a session history (same `sessionId` can have many rows).
  - dedup only by unique record `id`; no collapsing by `sessionId`.

## Current Status

- **Perplexity**: Stable auto-send implemented using a "warm-up" technique (Build 114).
- **ChatGPT**: Incognito mode toggle fixed (no longer hardcoded in URL).
- **Shimmer Indicator**: Visual feedback on slot chips during the entire Merge process.
- **Baseline**: Logic restored to stable Build 109 (based on Build 83) with modern fixes layered on top.

## Technical Implementation: Shimmer Effect

If a future developer needs to modify or replicate the "shimmering light" reflection on buttons:

1. **Class**: `ShimmerDrawable.kt`
2. **Method**: Uses `LinearGradient` with a transparent -> semi-transparent white -> transparent sequence.
3. **Blending**: Uses `PorterDuff.Mode.SRC_ATOP` to ensure the light reflection stays within the bounds of the button's shape.
4. **Animation**: Driven by `ValueAnimator` (0f to 1f) which translates the shader matrix X-offset.
5. **UI Integration**: In `MainActivity`, use `view.getOverlay().add(shimmer)`. This is CRITICAL for Material 3 Chips because they ignore standard `foreground` setters or custom backgrounds.
6. **Lifecycle**: 
   - Start: Called in `MergeFragment.runMerge()` via `activity.startMergeShimmer()`.
   - Stop: Called in `handleMergeResponses` (on success/failure/early exit) via `activity.stopMergeShimmer()`.

## Session Summary (2026-02-18)

### 1. The Perplexity "Two-Click" Mystery
- **Problem**: Perplexity required clicking "Send" twice. Logs showed the first click failed because the "Submit" button didn't exist in the DOM yet.
- **Discovery**: Perplexity's React UI only renders the send button AFTER the first character is typed.
- **Fix**: Implemented a "Warm-up" script in `MessageInjector.kt`. It inserts a space, waits 100ms for React to render the button, then replaces it with the real message and clicks.

### 2. The "Ghost Edit" Bug
- **Problem**: Occasionally, the app would click "Edit" on a previous message instead of sending a new one.
- **Fix**: Added `!el.closest('article')` filter to both input and button discovery. This prevents the script from ever interacting with historical messages.

### 3. ChatGPT Incognito Fix
- **Problem**: ChatGPT was always in incognito mode regardless of the setting.
- **Fix**: Removed `?temporary-chat=true` from the base URL in `ServiceConfig.kt`. It is now only appended dynamically in `ChatFragment.loadService` if the setting is actually ON.

### 4. Stability Restoration
- Reverted core injection logic to the proven Build 83/109 standard to eliminate regressions while keeping the new Perplexity/ChatGPT fixes.

## Key Decisions

1. Use `ViewOverlay` for animations on top of Material 3 components to avoid breaking their internal state/theming.
2. Maintain `insertText` via `document.execCommand` as the primary text injection method for React compatibility.
3. Isolate "Article" content in WebViews to prevent unintended interactions with chat history.
