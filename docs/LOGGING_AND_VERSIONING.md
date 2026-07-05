# Logging, Rotation & Versioning — ONE design for all clients

Cross-client contract for desktop (Electron), Android, iOS. Single source of
truth; per-client docs (`mobile/VERSIONING.md`) defer to this file.

## Versioning
| Client | Version source | Bump tool |
|---|---|---|
| desktop | `desktop/package.json` `version` | manual edit + CHANGELOG entry |
| Android + iOS | `mobile/android/version.properties` + `mobile/project.yml` (kept in sync) | `mobile/scripts/bump-version.sh <patch|push>` + `check-versioning.sh` |

Rules:
- Mobile versions move TOGETHER (one `bump-version.sh` run bumps both); never
  hand-edit one side.
- Every version bump gets a changelog entry the same commit.

## Changelogs
| File | Covers | Format |
|---|---|---|
| `mobile/CHANGELOG.md` | Android + iOS (joint) | `## X.Y.Z` headers, `- ` bullets (may wrap) |
| `desktop/CHANGELOG.md` | desktop | same |
| `mobile/android/CHANGELOG.md` | LEGACY (v1.x era) — frozen, do not update | `## [v1.x]` |

In-app changelog (parity feature): both mobile clients embed the latest 30
entries from `mobile/CHANGELOG.md` at build time and show them from the
settings menu ("Latest 30 changes").
- Android: gradle task `generateLatestChangelogResource`
  (`mobile/android/app/build.gradle.kts`) → `R.raw.changelog_latest`.
- iOS: `mobile/scripts/generate-changelog-resource.py` (run by
  `bootstrap-ios.sh` before xcodegen) → bundled `ChangelogLatest.txt`.
- ⚠️ The two extractors implement the SAME parsing (version headers with or
  without brackets; wrapped-bullet joining; `**`-stripping; 30-entry cap;
  blank line between entries). Change one → change the other, same commit.

## Logging
| Client | What | Where | Rotation |
|---|---|---|---|
| desktop | session-RPC trace | `debug-runs/session-rpc.log` (via `logSessionRpc` in `main.js`) | size-capped at 5 MB → truncated to the newest half (see `rotateLogIfNeeded`, main.js) |
| Android | runtime events | logcat only (`Log.i/w/e`, tag-based); debug builds enable WebView debugging | OS-managed |
| iOS | ingest event feed | in-memory `appendIngestEvent` (UI list, not persisted) | n/a (memory, bounded by session) |

Rules:
- Any NEW file-backed log on any client MUST ship with a size cap + rotation in
  the same change (default: 5 MB cap, keep newest half). No unbounded appends.
- Log lines carry a timestamp prefix; no secrets/API keys in log lines.
- Debug-only verbosity gates behind build type (Android debug / desktop env
  var), never shipped on by default in release.
