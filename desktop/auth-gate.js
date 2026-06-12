// Pure, dependency-free multi-user gate rule shared by the desktop backend
// calls (and mirrored by mobile AuthStore.gateBearer / iOS accessToken):
// a blank/absent access token means local-only — return null so callers skip
// the backend rather than falling back to the publishable key. This is the
// logic that stops a not-signed-in client from leaking rows with
// owner_id = null. See shared/contracts/AUTH_AND_SESSION_SYNC.md.
function bearerOrNull(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  return trimmed.length ? trimmed : null;
}

module.exports = { bearerOrNull };
