# Verity iOS

Native SwiftUI shell with persistent WKWebViews and shared provider scripts.
`mobile/project.yml` is the XcodeGen source of truth.

## Build and regression tests

On a Mac with full Xcode, from the repository root:

```sh
bash mobile/scripts/bootstrap-ios.sh
xcodebuild test -project mobile/VerityMobile.xcodeproj -scheme VerityMobile \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

Use an available simulator from `xcrun simctl list devices available`.
The iOS regression workflow selects one automatically. Run tests serially in a
disposable simulator: MobileAppState uses standard defaults.

`ColdLaunchTests` exercises the production initializer, stale session/note/prompt/
project state and conversation URLs, saved local/account snapshots, session
numbering, cached listing without activation, explicit Load and a synthetic
persistent WebView cookie. `AnonGateTests` covers signed-out backend isolation.
The cold-launch test reconstructs state within one process; it does not establish
OS-level persistence, real provider login, Keychain survival or background resume.
Contracts: `../shared/contracts/QUESTION_IDENTITY_RULES.md` and
`../shared/contracts/AUTH_AND_SESSION_SYNC.md`.

## iPhone acceptance — pending, not executed

Deploy from a paired Mac using `bash mobile/scripts/deploy-ios-device.sh`.
Record commit, installed version/build, device model and iOS version. Verify the
installed build; do not uninstall, clear website data or sign out between steps.

1. Sign into Verity and two providers. Record the saved-session list and a named
   session's number, project, providers and conversation URLs. Explicitly Load it;
   verify its canonical saved URLs and session/project indicator.
2. Background and reopen without force-quitting: the same context must remain.
3. Swipe Verity away in the app switcher, then launch from its icon: configured
   providers must open preset homes (allow normal provider redirects), with no
   old active session/note/prompt/project. Provider selections/enabled flags,
   provider login and Verity login must survive. Record independent token expiry.
4. Open Sessions and allow startup sync: saved account and retained local-only
   rows must remain; listing must not activate a row. Explicitly Load the recorded
   session: canonical conversations and session/project identity must return.
5. Force-quit/relaunch again: homes again. Repeat offline in local-only mode:
   local rows remain loadable, though pages may show network errors.

Record pass/fail separately for startup, resume, both kinds of login, saved lists
and explicit Load. A simulator/build/install result does not close device acceptance.
