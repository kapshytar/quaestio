# Question Identity Rules

This file is the mobile-shared contract for current-question semantics.

Implementations may stay separate on Android and iPhone for now, but behavior must match this document.

## Main Rule

One numeric `session_id` may contain multiple question roots.

Because of that:
- `session_id` alone is never enough
- `note_id` is the exact question-root identity
- `slot_urls` for that root are the canonical restore target

## Restore Priority

When loading a note-backed session on mobile:

1. trust `slot_urls`
2. restore platform WebViews to those URLs
3. recover `sessionId/noteId/sourcePrompt` from current slot fingerprint if needed

Do not prefer volatile `slot_live_urls` over `slot_urls` for note-backed session restore.

Reason:
- live URLs can belong to a previously open conversation
- a stale live URL can keep the client pinned to the wrong question while the session row itself is correct

## Current Question Recovery

If persisted `sessionId/noteId/sourcePrompt` state is stale or incomplete, clients should recover current question context from:

1. enabled slot live URLs
2. conversation-key fingerprint
3. recovered/source prompt

The goal is semantic parity:
- same live chats
- same current question
- same overwrite/create-root decision

## Prompt Recovery

Current prompt resolution priority:

1. fresh pending prompt from a just-sent message
2. prompt recovered from current scrape metadata
3. loaded session prompt
4. document-title fallback only if nothing better exists

## Platform Split

This contract is shared.
The implementation may stay separate in:
- `android/`
- `ios/`

Until mobile behavior stabilizes, do not force a single runtime implementation.
