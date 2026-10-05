package com.dialer.callstyle

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

/**
 * `window.DialerNative` у WebView: JS показує й прибирає сповіщення, Kotlin повертає дії користувача
 * подією `callstyle` на `window` (`detail: { type: 'answer' | 'decline', callId }`).
 * Методи викликає потік моста WebView, не головний.
 */
object Bridge {
  const val EXTRA_ANSWER = "dialer.callstyle.answer"
  private const val PREFS = "dialer.callstyle"

  private var context: Context? = null
  private var activity: Activity? = null
  private var webView: WebView? = null
  private var pendingAnswer: String? = null
  private var pendingOpen: String? = null
  private var ringtone: Ringtone? = null
  private val main = Handler(Looper.getMainLooper())
  /** Мелодія в застосунку не звучить довше за таймаут дзвінка, навіть якщо JS заморозили й він не встиг її зупинити. */
  private const val RING_MAX_MS = 60_000L

  fun attach(activity: Activity, webView: WebView) {
    this.activity = activity
    this.context = activity.applicationContext
    this.webView = webView
  }

  @JavascriptInterface
  fun show(json: String) {
    val ctx = context ?: return
    val o = JSONObject(json)
    stopRingtone() // далі мелодію грає служба вхідного
    IncomingNotifications.show(ctx, o.getString("callId"), o.optString("name"), o.optLong("expiresAt"), null)
  }

  /** Адреса сервера: на неї «Відхилити» шле `POST /push/reject`, коли застосунок не запущено (FCM). */
  @JavascriptInterface
  fun setServer(url: String) {
    context?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.putString("server", url)?.apply()
  }

  fun serverUrl(ctx: Context): String? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("server", null)

  /** Просить токен FCM; відповідь приходить подією `token` (без Firebase чи Google Play — тиша). */
  @JavascriptInterface
  fun requestFcmToken() {
    try {
      FirebaseMessaging.getInstance().token.addOnSuccessListener { emit("token", "", it) }
    } catch (_: Exception) {
      // немає google-services.json: FCM вимкнено, працює лише сигналізація
    }
  }

  @JavascriptInterface
  fun cancel(callId: String) {
    context?.let { IncomingNotifications.cancel(it, callId) }
  }

  /** Системна мелодія дзвінка, поки вхідний на екрані застосунку (сповіщення тоді знято й саме не дзвонить). */
  @JavascriptInterface
  fun startRingtone() {
    val ctx = context ?: return
    main.post {
      stopRingtoneNow()
      val tone = RingtoneManager.getRingtone(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)) ?: return@post
      tone.audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) tone.isLooping = true
      tone.play()
      Log.d(IncomingNotifications.LOG, "in-app ringtone playing=${tone.isPlaying}")
      ringtone = tone
      main.postDelayed({ stopRingtoneNow() }, RING_MAX_MS)
    }
  }

  @JavascriptInterface
  fun stopRingtone() {
    main.post { stopRingtoneNow() }
  }

  private fun stopRingtoneNow() {
    main.removeCallbacksAndMessages(null)
    ringtone?.stop()
    ringtone = null
  }

  /** `callId` дзвінка, на який відповіли в сповіщенні, коли застосунок ще не встиг підняти JS; порожньо, якщо немає. */
  @JavascriptInterface
  fun takeLaunchAnswer(): String {
    val id = pendingAnswer ?: return ""
    pendingAnswer = null
    return id
  }

  /** Вкладка, яку просило відкрити сповіщення (`history`), коли застосунок ще не встиг підняти JS; порожньо, якщо немає. */
  @JavascriptInterface
  fun takeLaunchOpen(): String {
    val tab = pendingOpen ?: return ""
    pendingOpen = null
    return tab
  }

  fun handleIntent(intent: Intent?) {
    // відкрито повноекранним інтентом на заблокованому телефоні: показуємо застосунок поверх екрана блокування
    if (intent?.getBooleanExtra(IncomingNotifications.EXTRA_FULLSCREEN, false) == true) {
      intent.removeExtra(IncomingNotifications.EXTRA_FULLSCREEN)
      activity?.setShowWhenLocked(true)
      activity?.setTurnScreenOn(true)
    }
    // тап по «Пропущений дзвінок»: відкрити вкладку історії
    intent?.getStringExtra(IncomingNotifications.EXTRA_OPEN)?.let {
      intent.removeExtra(IncomingNotifications.EXTRA_OPEN)
      pendingOpen = it
      emit("open", "", it)
    }
    val id = intent?.getStringExtra(EXTRA_ANSWER) ?: return
    intent.removeExtra(EXTRA_ANSWER)
    pendingAnswer = id
    stopRingtone()
    context?.let { IncomingNotifications.cancel(it, id) }
    emit("answer", id)
  }

  fun emit(type: String, callId: String, token: String? = null) {
    val view = webView ?: return
    val detail = JSONObject().put("type", type).put("callId", callId)
    if (token != null) detail.put("token", token)
    view.post { view.evaluateJavascript("window.dispatchEvent(new CustomEvent('callstyle',{detail:$detail}))", null) }
  }
}
