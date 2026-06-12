# Google Play Release Checklist (Gunshi)

## 1) Build Artifact
- Use `chat-aggregator-release-aab` from GitHub Actions.
- Upload only `.aab` to Google Play production tracks.

## 2) App Signing
- Keep the same upload key as previous builds.
- In Play Console: `Setup -> App integrity`, confirm key fingerprints are stable.

## 3) Subscription Setup
- Product ID in app code: `gunshi_monthly` (`PlayBillingManager.SUBSCRIPTION_PRODUCT_ID`).
- Create subscription `gunshi_monthly` in Play Console.
- Add base plan: monthly recurring, price `USD 0.99`.
- Add offer: `7-day free trial` (introductory/trial offer).
- Activate subscription and base plan.

## 4) Test Billing Before Production
- Add tester accounts in `Monetize -> License testing`.
- Publish to `Internal testing` track first.
- Verify flows:
  - No subscription: normal text is blocked and billing screen opens.
  - Cheat unlock code path works locally and does not send text to chats.
  - Active subscription allows normal send flow.

## 5) Store Listing Minimum
- App name: `Gunshi`.
- App icon: 512x512 (Play icon) plus launcher icon already in app resources.
- Short description + full description.
- Screenshots (phone required; tablet optional).
- Privacy policy URL (required for production publishing with billing/web content).

## 6) Policy/Declarations
- Complete Data Safety form.
- Complete ads declaration (if no ads, declare no ads).
- Confirm target SDK and permissions declarations.

## 7) Release Flow
- Create production release from tested AAB.
- Add release notes.
- Roll out gradually (recommended) and monitor crashes/ANR after rollout.
