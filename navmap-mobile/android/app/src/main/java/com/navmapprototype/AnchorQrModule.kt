package com.navmapprototype

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * In-app QR fallback (used ONLY if the P0 external-camera handoff of
 * navmap://anchor/ fails on the target phone).
 * Wire to open-source ZXing Android Embedded: launch
 * com.google.zxing.client.android.SCAN via startActivityForResult and feed
 * the decoded payload to the pure TS parseAnchorUrl(). Camera permission is
 * requested only on tapping Scan QR. Until the ZXing dependency is added,
 * scanAnchor() rejects with SCANNER_UNAVAILABLE and the UI offers manual
 * anchor-code entry.
 */
class AnchorQrModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pending: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "AnchorQrModule"

  @ReactMethod
  fun scanAnchor(promise: Promise) {
    val activity: Activity? = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "scanAnchor needs a foreground activity")
      return
    }
    // TODO(P0-handoff): if external camera handles navmap://, leave this
    // unbuilt. Otherwise add jxzxing/android-embedded + camera permission
    // and start the SCAN intent here.
    pending = promise
    promise.reject("SCANNER_UNAVAILABLE", "in-app scanner not built yet; enter anchor code manually")
    pending = null
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    // ZXing result handling goes here once the dependency is added.
  }

  override fun onNewIntent(intent: Intent) {}
}
