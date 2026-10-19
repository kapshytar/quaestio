# iOS cold launch regression

Reviewed against main at 0d8874f and startup fix f9c2d41. Production startup
already resets provider URLs, parallel-ingest state, prompt and active project.
It does not remove session snapshots or WebView data. No runtime fix is repeated.

Available contracts: `mobile/shared/contracts/QUESTION_IDENTITY_RULES.md` and
`AUTH_AND_SESSION_SYNC.md`. Canonical snapshot URLs win on explicit Load; listing
sessions must not load one. Provider authentication uses persistent
`WKWebsiteDataStore.default()`; Verity account credentials use Keychain separately.
`Verity/AGENTSYNC.md` and `docs/domains/SESSION_AND_INGEST_RULES.md` are not present
in this checkout; their contents/acceptance status cannot be independently verified.

## Automated scope

`ColdLaunchTests` invokes the production MobileAppState initializer repeatedly,
with persisted conversation URLs and fully populated stale question/project state.
It checks fresh home URLs/context, unchanged local and cached account snapshots,
unchanged session numbering, cached list availability without activation, explicit
Load, layout preferences, and a synthetic cookie in the persistent WebView store.
Existing AnonGateTests remain unchanged and run alongside it. The test restores
mobile UserDefaults after completion and deletes only its synthetic cookie.

This is an in-process reconstruction test, not a process-kill or real provider
login test. It does not prove cookies survive OS termination, Keychain login
survives, provider redirects behave correctly, or background lifecycle behavior.
No real credentials are seeded or logged. Use a disposable simulator test host.

On a Mac with full Xcode:

```sh
bash mobile/scripts/bootstrap-ios.sh
xcodebuild test -project mobile/VerityMobile.xcodeproj -scheme VerityMobile \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Replace simulator name with an available iPhone from `xcrun simctl list devices available`.
The iOS regression workflow selects an available simulator automatically.

## Real iPhone acceptance — NOT EXECUTED

Record device model, iOS version, installed Verity version/build, commit and time.
Install through `mobile/scripts/deploy-ios-device.sh` on a paired Mac; verify the
installed build. Do not uninstall, clear website data, or sign out between steps.

1. Sign into Verity and at least two provider WebViews. Have a named saved session
   with recognizable conversation URLs; record its session number, project and
   provider slots. Also retain a local-only saved session if available.
2. Choose **Load session** for that session. Confirm the saved conversations,
   session indicator and project appear. Record the initial saved-session list.
3. Send Verity to the background and return without force-quitting. Expected:
   the same workspace/conversations remain active; no fresh-start reset.
4. Open the iOS app switcher and swipe Verity away. Launch Verity from its icon.
   Expected: every configured provider opens its preset home URL (allow ordinary
   provider redirects); no prior conversation automatically opens. The old active
   session/note/prompt/project must not be selected or shown as active. Provider
   selection/enabled settings remain. No app or provider sign-in is requested
   merely because of restarting (independent token expiry must be recorded).
5. Open Sessions; allow normal startup sync to finish. Expected: saved account
   sessions and retained local-only sessions remain available; opening the list
   does not activate a row or navigate to old conversations.
6. Explicitly load the recorded session again. Expected: its canonical saved
   conversations return, with its session/project identity. Provider accounts
   remain signed in. Repeat force-quit/relaunch: fresh provider homes again.
7. Repeat in local-only mode while offline, using a local saved session. Expected:
   cached/local list remains available and explicit Load restores its saved URLs
   (pages may show network errors); restarting does not auto-load it or erase it.

Record pass/fail separately for fresh startup, background resume, account login,
provider login, saved lists and explicit Load. A build/install or simulator result
alone does not close real-device acceptance.
