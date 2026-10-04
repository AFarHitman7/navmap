package com.navmapprototype

import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * Logs incoming navmap://anchor deep links (cold start + resume) so the P0
 * camera-handoff check has an observable. JS dedupes via handleAnchorUrl().
 */
class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "NavMapPrototype"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    logDeepLink(intent, "cold-start")
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    logDeepLink(intent, "resumed")
  }

  private fun logDeepLink(intent: Intent?, via: String) {
    val url = intent?.data?.toString() ?: return
    if (url.startsWith("navmap://anchor/")) {
      Log.i("NavMapAnchor", "anchor link ($via): $url")
    }
  }
}
