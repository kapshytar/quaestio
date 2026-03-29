# chat-aggregator-mobile - Working Notes

## Purpose

This repo is the future shared mobile monorepo for:

- Android
- iOS
- shared JS injection/scrape logic

## Current Reality

- Android source of truth is still the sibling repo `../chat-aggregator-android`.
- This repo currently holds only scaffold/docs/placeholders.
- Do not claim Android has been migrated here until the code actually lives under `android/`.

## Priority Rules

- Keep migration incremental and reversible.
- Prefer moving shared JS/contracts before moving full native project structures.
- Preserve current Android shipping behavior while the monorepo is still forming.
- Avoid inventing shared abstractions before there is duplicated logic to justify them.

## Planned Shared Areas

- `shared/js/sendMessage.js`
- `shared/js/scrapeReply.js`
- `shared/contracts/` for payload schemas and integration notes

## Planned Non-Shared Areas

- Android UI and lifecycle glue
- iOS UI and lifecycle glue
- billing/subscription code
- platform-specific cookie import flows

