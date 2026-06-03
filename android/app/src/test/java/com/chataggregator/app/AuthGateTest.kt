package com.chataggregator.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression guard for the multi-user gate rule shared across clients:
 * a blank/absent access token means local-only — callers must skip the backend
 * (return null), never fall back to the publishable key. This is the logic that
 * stops a not-logged-in device from leaking rows with `owner_id = null`.
 * See `shared/contracts/AUTH_AND_SESSION_SYNC.md`. The iOS side proves the same
 * invariant at the network level in `VerityMobileTests/AnonGateTests`.
 */
class AuthGateTest {

    @Test
    fun nullTokenSkipsBackend() {
        assertNull("signed out (null token) must skip the backend", AuthStore.gateBearer(null))
    }

    @Test
    fun blankTokenSkipsBackend() {
        assertNull(AuthStore.gateBearer(""))
        assertNull(AuthStore.gateBearer("   "))
    }

    @Test
    fun validTokenPassesThroughTrimmed() {
        assertEquals("jwt-abc", AuthStore.gateBearer("jwt-abc"))
        assertEquals("jwt-abc", AuthStore.gateBearer("  jwt-abc  "))
    }
}
