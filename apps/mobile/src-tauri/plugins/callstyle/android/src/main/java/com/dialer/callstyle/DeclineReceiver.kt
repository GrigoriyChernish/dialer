package com.dialer.callstyle

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import org.json.JSONObject

/**
 * Кнопка «Відхилити»: прибирає сповіщення й передає рішення застосунку (він завершує дзвінок через сигналізацію).
 * Якщо дзвінок прийшов через FCM (є `rejectToken`), додатково шле `POST /push/reject`: застосунок може не працювати.
 */
class DeclineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(IncomingNotifications.EXTRA_CALL_ID) ?: return
    IncomingNotifications.cancel(context, id)
    Bridge.emit("decline", id)
    val token = intent.getStringExtra(IncomingNotifications.EXTRA_REJECT_TOKEN) ?: return
    val server = Bridge.serverUrl(context) ?: return
    val pending = goAsync()
    thread {
      try {
        val conn = URL(server.trimEnd('/') + "/push/reject").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.doOutput = true
        conn.setRequestProperty("content-type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("token", token).toString().toByteArray()) }
        conn.responseCode
        conn.disconnect()
      } catch (_: Exception) {
        // сервер недоступний: дзвінок завершиться за таймаутом
      } finally {
        pending.finish()
      }
    }
  }
}
