# Feature Hand-Off: "Find in Page" for all tabs

**Target Agent:** Codex (or next available CLI agent)
**Task:** Implement a unified "Find in Page" (search text) feature across all tabs in the Gunshi application.

## Core Requirements
1. **Global Search UI:** The user should be able to trigger a search bar via the global Activity `settings_menu.xml`. 
    - The search UI should include: an `EditText` for the query, a "Next" button, a "Prev" button, and a "Close (X)" button.
2. **Unified Interface (`Findable`):** 
    - Create an interface `Findable` with methods like `startFind(query: String)`, `findNext()`, `findPrev()`, and `clearFind()`.
    - Both `ChatFragment` and `MergeFragment` must implement this interface.
3. **WebView Chat Slots (`ChatFragment`)**:
    - Use Android's native `WebView.findAllAsync(query)`.
    - Use `WebView.findNext(true)` for next, and `WebView.findNext(false)` for previous.
    - Call `WebView.clearMatches()` when closed.
4. **Markdown Native View (`MergeFragment`)**:
    - The Merge tab displays Markwon-rendered text in a native `TextView`.
    - You must implement a custom `BackgroundColorSpan` (or similar `CharacterStyle`) highlighting system in `MergeFragment.kt` to find all occurrences of the query (case-insensitive) in `binding.mergeResult.text`.
    - Maintain an index of current matches, highlight them all in yellow, and highlight the "active" match in a brighter color (e.g., orange).
    - Scroll the `TextView` (or its parent `ScrollView`/`NestedScrollView`) to the active match when Next/Prev is clicked.

## Implementation Steps
1. Define the `Findable` interface (e.g. in a new file `Findable.kt`).
2. Add the search bar UI to `activity_main.xml` (e.g. `FrameLayout` overlay at the top, `visibility="gone"` by default).
3. Bind the UI in `MainActivity.kt`.
    - Listen for text changes or "Search" action on the keyboard.
    - Get the current Fragment via `(binding.viewPager.adapter as ChatPagerAdapter).getFragment(binding.viewPager.currentItem)`. Note that `FragmentStateAdapter` might require you to use `supportFragmentManager.findFragmentByTag("f${binding.viewPager.currentItem}")` if the adapter doesn't hold strong references.
    - Cast it to `Findable` and pass the commands.
4. Implement `Findable` in `ChatFragment` (easy, native WebView APIs).
5. Implement `Findable` in `MergeFragment`. 
    - You'll need to grab the `SpannableString` from `binding.mergeResult.text`, clear old highlight spans, find the indices of the query matches, and attach new highlighting spans.
    - To scroll to a specific span, use `Layout.getLineTop(line)` from the TextView's layout.
6. Build and test by following the deployment guide (`ca-build` and `ca-install`).

## Context to read before writing code
- `GEMINI.md`
- `AGENTS.md`
- `CLAUDE.md`
