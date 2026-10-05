package com.dialer.callstyle

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

/**
 * Підключає міст `window.DialerNative` до WebView і ловить інтент «Відповісти» зі сповіщення.
 * Команд Tauri немає: JS викликає міст напряму (`web/src/shared/native/callstyle.ts`).
 */
@TauriPlugin
class CallStylePlugin(private val activity: Activity) : Plugin(activity) {
  override fun load(webView: WebView) {
    super.load(webView)
    Bridge.attach(activity, webView)
    webView.addJavascriptInterface(Bridge, "DialerNative")
    Bridge.handleIntent(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    Bridge.handleIntent(intent)
  }
}
