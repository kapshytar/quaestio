# Gunshi Android - Current Context (Feb 20, 2026)

## Session Management Update (2026-03-05)
- Session UI is integrated in `MainActivity.showSessionsDialog()`.
- Persistence path: Supabase bridge RPC `aggregator_sessions_bridge_v1` with SharedPreferences fallback.
- Sessions list item is two-line:
  - line 1: `S<sessionId> <name>`
  - line 2: date/time in small gray text.
- Tap: load session snapshot.
- Long tap: delete session with confirmation (local + remote delete).
- Ordering: newest first by parsed timestamp.
- Timestamp parse supports both backend styles:
  - `updatedAt` / `createdAt`
  - `updated_at` / `created_at`
- Desktop parity rule:
  - keep all prompts within one `sessionId` visible in history;
  - deduplicate only by unique record `id` (do not collapse by `sessionId`).

## Project Snapshot
- App: Gunshi Android (single-activity, 4 WebView chat slots + Merge tab)
- Main branch: `main`
- Latest stability commits:
  - `56b9c00` - Find-in-page feature + workspace updates
  - `3314829` - Fix Kotlin DSL for AGP9 without duplicate plugin application

## Build/CI Status
- CI workflow: `.github/workflows/build-apk.yml`
- Relevant runs:
  - `22231405565` - failed (initial post-feature run)
  - `22232326441` - failed (duplicate Kotlin plugin extension)
  - `22232441000` - **success** (current good run)
- Latest artifact: `chat-aggregator-build-142`
- Local artifact paths:
  - `C:\chat-aggregator-android\ci-output\latest-ci-install\app-release.apk`
  - `C:\chat-aggregator-android\ci-output\latest-ci-install\app-release.aab`

## Common Issues & Solutions

### "Device or resource busy" when moving directories
- **Cause**: Windows file locks on git repos or node_modules
- **Fix**: Use copy then delete instead of move:
  ```bash
  cp -r source_dir dest_dir
  rm -rf source_dir
  ```

### Finding broken paths after project moves
1. Search: `grep -r "C:\\Users\\kvita\\PROJECTS" .` (in project root)
2. Common files with hardcoded paths:
   - `.gradle/gradle.properties`
   - `local.properties`
   - Build output references in CI logs
3. Update: Use Edit tool with `replace_all: true`
4. Verify: Run `./gradlew assembleDebug` to ensure paths work

### Build failures after directory moves
- Check `.gradle-ci/` and `.gradle/` cache (may have stale paths)
- Solution: Delete caches and rebuild - gradle will re-download dependencies
- Time: First rebuild takes longer (~5-10min depending on internet)

---

## Critical CI Learnings
- Failure #1 root cause:
  - `app/build.gradle.kts` used `kotlinOptions { jvmTarget = "17" }` in a configuration where that symbol was unresolved.
- Failure #2 root cause:
  - adding `id("org.jetbrains.kotlin.android")` at module level caused `Cannot add extension with name 'kotlin'`.
- Final stable fix (`3314829`):
  - keep `plugins { id("com.android.application") }`
  - configure Kotlin via:
    - `kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }; jvmToolchain(17) }`

## Find Feature State
- Global Find-in-page is implemented and merged:
  - `app/src/main/java/com/chataggregator/app/Findable.kt`
  - `app/src/main/java/com/chataggregator/app/MainActivity.kt`
  - `app/src/main/java/com/chataggregator/app/ChatFragment.kt`
  - `app/src/main/java/com/chataggregator/app/MergeFragment.kt`
  - `app/src/main/res/layout/activity_main.xml`
  - `app/src/main/res/layout/fragment_merge.xml`
  - `app/src/main/res/menu/settings_menu.xml`
  - `app/src/main/res/values/strings.xml`

## Device/Install Status
- Last verified USB device: `R58M550RNCH` (`SM-G975U`)
- APK install command succeeded after CI success:
  - `adb install -r C:\chat-aggregator-android\ci-output\latest-ci-install\app-release.apk`

## Practical Commands
- Watch latest CI run:
  - `gh run list --repo kvitaliq-maker/chat-aggregator-android --limit 3`
  - `gh run watch <run_id> --repo kvitaliq-maker/chat-aggregator-android --exit-status`
- Download artifacts:
  - `gh run download <run_id> --repo kvitaliq-maker/chat-aggregator-android --name chat-aggregator-build-<N> --dir ci-output/latest-ci-install`
- Install APK:
  - `adb devices -l`
  - `adb install -r ci-output/latest-ci-install/app-release.apk`

## Session Management (Feb 26, 2026)

### Latest Addition - SessionManager.kt
- **Commit**: `632377b` - Add session management to Android app
- **File**: `app/src/main/java/com/chataggregator/app/SessionManager.kt` (142 lines)
- **Status**: ✅ Code complete, ⚠️ UI integration pending

### What It Does
- Saves current slot configuration as session snapshots
- Persists to SharedPreferences (JSON format)
- Load/restore sessions to apply saved slot configurations
- Max 20 sessions stored (most recent first)
- Placeholder for future database sync capability

### Key Classes
```kotlin
class SessionManager(context: Context, private val slotManager: SlotManager) {
  fun saveCurrentSession(name: String = ""): SessionSnapshot
  fun loadSession(sessionId: String): Boolean
  fun getAllSessions(): List<SessionSnapshot>
  fun deleteSession(sessionId: String)
  suspend fun syncSessionToDatabase(session: SessionSnapshot): Boolean // placeholder
}

data class SessionSnapshot(
  val id: String,
  val timestamp: Long,
  val sessionId: Int? = null,
  val name: String = "",
  val slotConfig: Map<String, String> = emptyMap(),
  val slotUrls: Map<String, String> = emptyMap(),
  val slotEnabled: Map<String, Boolean> = emptyMap(),
  val createdAt: String = "",
  val updatedAt: String = ""
)
```

### Integration Needed
- [ ] Add UI buttons to MainActivity for save/load/delete sessions
- [ ] Wire SessionManager into ChatFragment/MergeFragment
- [ ] Implement HTTP client for syncSessionToDatabase()
- [ ] Test full session save/load cycle with device

### Backend Sync
- Currently uses SharedPreferences only
- Placeholder ready for dream-tracker backend integration
- Will require HTTP client implementation when enabled

## Notes
- Use push-triggered CI by default; avoid manual `workflow_dispatch` unless explicitly requested.
- Keep handoff notes current here so the next agent can skip CI forensics repetition.
- Session management code is complete but needs UI integration - see HANDOFF_SESSIONS_2026-02-26.md in dream-tracker for full details
## Session RPC Contract (Current)
- Android session persistence must use Supabase RPC `aggregator_sessions_bridge_v1`.
- Action is selected by `p_action`:
  - `save` (with `p_session_id`, `p_name`, `p_slot_config`, `p_slot_urls`, `p_slot_enabled`)
  - `list` (with optional `p_session_id`, `p_limit`)
  - `delete` (with `p_record_id`)
- Do not add new direct calls to legacy RPCs (`save_aggregator_session`, `list_aggregator_sessions`, `delete_aggregator_session`).
