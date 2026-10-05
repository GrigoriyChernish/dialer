package com.dialer.callstyle

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat

/** Сповіщення про вхідний у стилі дзвінка (`CallStyle`) з кнопками «Відповісти» і «Відхилити» та мелодією до відповіді. */
object IncomingNotifications {
  const val EXTRA_CALL_ID = "dialer.callstyle.callId"
  const val EXTRA_OPEN = "dialer.callstyle.open"
  const val EXTRA_FULLSCREEN = "dialer.callstyle.fullscreen"
  const val EXTRA_REJECT_TOKEN = "dialer.callstyle.rejectToken"
  const val EXTRA_NAME = "dialer.callstyle.name"
  const val EXTRA_EXPIRES_AT = "dialer.callstyle.expiresAt"
  const val LOG = "DialerCall"
  private const val MISSED_CHANNEL = "missed_calls"
  private const val CHANNEL = "incoming_calls_silent"
  private const val TAG = "dialer.incoming"

  fun id(callId: String) = callId.hashCode()

  /** Канал без звуку й вібрації: мелодію й вібрацію веде `IncomingCallService` (звук каналу не повторюється, Samsung ігнорує `INSISTENT`). */
  private fun ensureChannel(ctx: Context) {
    val manager = ctx.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val channel = NotificationChannel(CHANNEL, "Вхідні дзвінки", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Сповіщення про вхідний дзвінок"
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  /** Аватар-заглушка: коло з першою літерою імені. */
  private fun avatar(name: String): IconCompat {
    val size = 192
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = Color.parseColor("#6366F1")
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.color = Color.WHITE
    paint.textSize = size * 0.5f
    paint.textAlign = Paint.Align.CENTER
    val letter = name.trim().take(1).uppercase().ifEmpty { "?" }
    val y = size / 2f - (paint.descent() + paint.ascent()) / 2f
    canvas.drawText(letter, size / 2f, y, paint)
    return IconCompat.createWithBitmap(bitmap)
  }

  private fun openApp(ctx: Context, callId: String?): Intent =
    (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      if (callId != null) putExtra(Bridge.EXTRA_ANSWER, callId)
    }

  /** Показує сповіщення через foreground-службу: вона ж грає мелодію й вібрує, поки дзвінок не завершили чи не спливе таймаут. */
  fun show(ctx: Context, callId: String, name: String, expiresAt: Long, rejectToken: String?) {
    Log.d(LOG, "show $callId name=$name expiresAt=$expiresAt")
    try {
      ContextCompat.startForegroundService(
        ctx,
        Intent(ctx, IncomingCallService::class.java)
          .putExtra(EXTRA_CALL_ID, callId)
          .putExtra(EXTRA_NAME, name)
          .putExtra(EXTRA_EXPIRES_AT, expiresAt)
          .putExtra(EXTRA_REJECT_TOKEN, rejectToken),
      )
    } catch (e: Exception) {
      // з фону Android може не дозволити службу: лишаємо хоча б сповіщення без мелодії
      Log.e(LOG, "не вдалося запустити службу вхідного", e)
      ctx.getSystemService(NotificationManager::class.java).notify(id(callId), build(ctx, callId, name, expiresAt, rejectToken))
    }
  }

  fun build(ctx: Context, callId: String, name: String, expiresAt: Long, rejectToken: String?): Notification {
    ensureChannel(ctx)
    val nid = id(callId)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val answer = PendingIntent.getActivity(ctx, nid, openApp(ctx, callId), flags)
    val open = PendingIntent.getActivity(ctx, nid + 1, openApp(ctx, null), flags)
    // на заблокованому телефоні Android сам відкриває застосунок поверх екрана блокування; на розблокованому лишається сповіщення зверху
    val fullScreen = PendingIntent.getActivity(ctx, nid + 4, openApp(ctx, null).putExtra(EXTRA_FULLSCREEN, true), flags)
    val decline = PendingIntent.getBroadcast(
      ctx,
      nid + 2,
      Intent(ctx, DeclineReceiver::class.java).putExtra(EXTRA_CALL_ID, callId).putExtra(EXTRA_REJECT_TOKEN, rejectToken),
      flags,
    )
    val person = Person.Builder().setName(name.ifBlank { "Невідомий" }).setIcon(avatar(name)).setImportant(true).build()
    val builder = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentIntent(open)
      .setFullScreenIntent(fullScreen, true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
    // дзвінок скінчився без нас (сервер зніме й сам): сповіщення не лишається назавжди
    val ttl = expiresAt - System.currentTimeMillis()
    if (expiresAt > 0 && ttl > 0) builder.setTimeoutAfter(ttl)
    return builder.build()
  }

  fun cancel(ctx: Context, callId: String) {
    Log.d(LOG, "cancel $callId")
    IncomingCallService.stop(ctx, callId)
    ctx.getSystemService(NotificationManager::class.java).cancel(id(callId))
  }

  /** «Пропущений дзвінок» після FCM про скасований чи неприйнятий дзвінок. */
  fun showMissed(ctx: Context, callId: String, name: String) {
    val manager = ctx.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(MISSED_CHANNEL) == null)
      manager.createNotificationChannel(
        NotificationChannel(MISSED_CHANNEL, "Пропущені дзвінки", NotificationManager.IMPORTANCE_DEFAULT),
      )
    val open = PendingIntent.getActivity(
      ctx,
      id(callId) + 3,
      openApp(ctx, null).putExtra(EXTRA_OPEN, "history"),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(ctx, MISSED_CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_missed)
      .setContentTitle("Пропущений дзвінок")
      .setContentText(name.ifBlank { "Невідомий" })
      .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    manager.notify(TAG + ".missed", id(callId), notification)
  }
}
