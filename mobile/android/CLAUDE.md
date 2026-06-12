# Gunshi Android - Working Notes

Repo entry: see `../../VERITY_MAP.md` and `../CURRENT_STATE.md`.

## App Shape
- Single-activity Android, 4 WebView chat slots + Merge tab.
- Code under `app/src/main/java/com/chataggregator/app/`.

## Session Persistence Contract
- All session persistence must go through Supabase RPC `aggregator_sessions_bridge_v1`.
- `p_action` selects: `save` (with `p_session_id`, `p_name`, `p_slot_config`, `p_slot_urls`, `p_slot_enabled`), `list` (optional `p_session_id`, `p_limit`), `delete` (`p_record_id`).
- Do NOT call the legacy RPCs: `save_aggregator_session`, `list_aggregator_sessions`, `delete_aggregator_session`.

## Sessions UI Rules (parity with desktop)
- Sessions list item is two-line: line 1 `S<sessionId> <name>`, line 2 date/time.
- Tap loads, long-tap deletes (local + remote).
- Ordering: newest-first by parsed timestamp.
- Within one `sessionId`, keep all prompts visible; deduplicate only by unique record `id`, never collapse by `sessionId`.

## Build / Deploy
- Use the canonical script: `cd /Users/v/Verity/chat-aggregator-mobile && ./scripts/deploy-android-device.sh`.
- Pinned JDK from `android/gradle.properties` (`org.gradle.java.home`) — do not run raw `./gradlew` from memory.
- Prefer push-triggered CI; avoid manual `workflow_dispatch` unless asked.

## Archived Notes
Historical setup, Windows paths, Feb-2026 CI postmortems, and the SessionManager handoff that has long since been integrated have been removed. Pull from git history if needed.
