package com.navmapprototype

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Timestamped Wi-Fi scan bridge.
 * requestScan() returns whether the OS accepted the request. Results are
 * emitted ONLY after SCAN_RESULTS_AVAILABLE_ACTION with EXTRA_RESULTS_UPDATED,
 * using ScanResult.timestamp (microseconds since boot) — never Unix time.
 * Respects normal OS foreground throttling; passive platform scans also arrive.
 */
class WifiScanModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != WifiManager.SCAN_RESULTS_AVAILABLE_ACTION) return
      val updated = intent.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false)
      val wifi = context.applicationContext
        .getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      val results = try {
        wifi.scanResults
      } catch (e: SecurityException) {
        emitError(e.message ?: "location permission required")
        return
      }
      val arr = Arguments.createArray()
      for (r in results) {
        val m = Arguments.createMap()
        m.putString("bssid", r.BSSID ?: continue)
        m.putInt("rssi", r.level)
        // r.timestamp: microseconds since boot.
        m.putDouble("seenAtElapsedMicros", r.timestamp.toDouble())
        arr.pushMap(m)
      }
      val params = Arguments.createMap()
      params.putBoolean("updated", updated)
      params.putDouble(
        "observedAtElapsedMicros",
        SystemClock.elapsedRealtimeNanos() / 1000.0,
      )
      params.putArray("readings", arr)
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("WifiScanResults", params)
    }
  }

  init {
    reactContext.registerReceiver(
      receiver,
      IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION),
    )
  }

  override fun getName() = "WifiScanModule"

  @ReactMethod
  fun requestScan(promise: Promise) {
    val wifi = reactContext.applicationContext
      .getSystemService(Context.WIFI_SERVICE) as WifiManager
    try {
      promise.resolve(wifi.startScan())
    } catch (e: SecurityException) {
      promise.reject("PERMISSION", e.message)
    }
  }

  private fun emitError(message: String) {
    val params = Arguments.createMap()
    params.putString("error", message)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("WifiScanError", params)
  }
}
