package com.dialer.callstyle

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Data-повідомлення сервера (`apps/server/src/push/fcm.ts`) з високим пріоритетом: `call.incoming` показує CallStyle
 * (токен для «Відхилити» лежить у `rejectToken`), `call.ended` прибирає його, а для пропущеного показує звичайне сповіщення.
 */
class DialerMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val d = message.data
    val callId = d["callId"] ?: return
    try {
      handle(d, callId)
    } catch (e: Exception) {
      Log.e("DialerFcm", "не вдалося показати сповіщення", e)
    }
  }

  private fun handle(d: Map<String, String>, callId: String) {
    when (d["type"]) {
      "call.incoming" ->
        IncomingNotifications.show(
          applicationContext,
          callId,
          d["fromName"] ?: "",
          d["expiresAt"]?.toLongOrNull() ?: 0L,
          d["rejectToken"],
        )
      "call.ended" -> {
        IncomingNotifications.cancel(applicationContext, callId)
        if (d["missed"] == "1") IncomingNotifications.showMissed(applicationContext, callId, d["fromName"] ?: "")
      }
    }
  }

  override fun onNewToken(token: String) {
    Bridge.emit("token", "", token)
  }
}
