# Scraper pitfalls

Codex · gpt-6 · 01a1354d-15e0-7ff1-a472-253a4104411f · 2026-10-13 · /Users/v/Verity

## Claude boxless wrappers and multipart replies

A `display: contents` element has a zero-size rectangle while its children remain visible. Rejecting every zero-size ancestor erased the full answer in saved sessions 339, 340 and 341. Claude may also put several `data-perf-reply-text` blocks in one assistant turn around tool calls; selecting only the first block loses the continuation (observed in session 336).

The current behavior contract lives in [desktop/CURRENT_STATE.md](../desktop/CURRENT_STATE.md), Stable Scrape Behavior. `desktop/test/claude-scrape.electron.cjs` checks all original words in order across desktop, Android and iOS, with old-rule and overbroad-visibility mutations. Provider HTML and recovered answers remain local under ignored `desktop/debug-runs/`.

Applied 2026-10-13: reproduction caught zero-size ancestor pruning; multipart fixture caught first-block-only selection; hidden-content mutation caught an overbroad bypass. Device/live-app verification is separate from offline Chromium checks.

## Claude first-send controls

The generic send heuristic matched `ask` inside the observed `Add scheduled task` label. Before the real Send became actionable, mobile could click that unrelated control. The prior settings/account exclusions did not cover this label. The current exact-label contract lives in mobile/CURRENT_STATE.md, Stable; desktop implements the selection boundary too. `desktop/test/claude-send.electron.cjs` covers delayed first Send, repeat Send, broad-selector project decoys and missing Send. Removing the Claude fallback guard reproduces the wrong click.

## Xcode 26.5 needs a simulator runtime for device asset compilation

Observed on this Mac, 2026-10-13: `xcodebuild -showsdks` lists `iphoneos26.5`, but with no simulator runtime the scheme rejects every iOS destination. Building the target directly with `-sdk iphoneos` starts compilation, then actool fails with `No available simulator runtimes for platform iphonesimulator`. A listed SDK is not proof that the full build dependencies exist. `-runFirstLaunch -checkForNewerComponents` found no updates and did not solve it.

Check the Mac architecture before downloading: this Mac is Intel (`x86_64`), so use `-architectureVariant universal` (10.6 GB). An arm64-only runtime (8.52 GB) installs but fails with `Bad CPU type in executable` / `liblaunch_sim.dylib could not be opened`; it was removed using its exact `simctl runtime delete` identifier. Determine and communicate download size before starting. The first download was stopped at 3.84 GB after the owner's objection; cancellation removed the partial image (runtime asset directory 8 KB, CoreSimulator Images 4 KB, disk availability returned to 73 GiB). The owner authorized a new download only after the no-runtime build failure was demonstrated.

Useful SDK/runtime dependencies must remain installed during closure. The universal runtime was deleted after installation before the owner clarified “leave it”; future iOS builds need another download. The owner deferred that download.
