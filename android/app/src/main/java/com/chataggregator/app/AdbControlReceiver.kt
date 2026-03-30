package com.chataggregator.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class AdbControlReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "AdbControlReceiver"
        const val ACTION_SET_DETAILED_LOGGING = "com.chataggregator.app.action.SET_DETAILED_LOGGING"
        const val ACTION_SET_UNSTABLE_FEATURES = "com.chataggregator.app.action.SET_UNSTABLE_FEATURES"
        const val EXTRA_ENABLED = "enabled"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val enabled = intent.getBooleanExtra(EXTRA_ENABLED, false)
        when (action) {
            ACTION_SET_DETAILED_LOGGING -> {
                SettingsManager.setDetailedLoggingEnabled(context, enabled)
                Log.i(TAG, "Detailed logging set via ADB: $enabled")
            }
            ACTION_SET_UNSTABLE_FEATURES -> {
                SettingsManager.setUnstableFeaturesEnabled(context, enabled)
                Log.i(TAG, "Unstable features set via ADB: $enabled")
            }
            else -> {
                Log.w(TAG, "Unknown ADB action: $action")
            }
        }
    }
}
