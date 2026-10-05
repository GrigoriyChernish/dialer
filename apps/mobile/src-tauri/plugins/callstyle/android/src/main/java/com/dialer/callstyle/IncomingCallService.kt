package com.dialer.callstyle

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

/**
 * Foreground-служба вхідного: її сповіщення це `CallStyle`, а сама вона грає системну мелодію по колу й вібрує.
 * Системний звук сповіщення Samsung не повторює (грає ~2 с), тож мелодію ведемо самі. Зупиняється, коли дзвінок
 * скінчився (`stop`), на таймауті дзвінка чи найпізніше через `MAX_MS`.
 */
class IncomingCallService : Service() {
  private var ringtone: Ringtone? = null
  private var callId: String? = null
  private val handler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra(IncomingNotifications.EXTRA_CALL_ID)
    if (id == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    val name = intent.getStringExtra(IncomingNotifications.EXTRA_NAME) ?: ""
    val expiresAt = intent.getLongExtra(IncomingNotifications.EXTRA_EXPIRES_AT, 0L)
    val notification = IncomingNotifications.build(this, id, name, expiresAt, intent.getStringExtra(IncomingNotifications.EXTRA_REJECT_TOKEN))
    val nid = IncomingNotifications.id(id)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        startForeground(nid, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      else startForeground(nid, notification)
    } catch (e: Exception) {
      Log.e(IncomingNotifications.LOG, "startForeground не вдався", e)
      stopSelf()
      return START_NOT_STICKY
    }
    callId = id
    Log.d(IncomingNotifications.LOG, "service started $id")
    startRinging()
    val ttl = expiresAt - System.currentTimeMillis()
    handler.removeCallbacksAndMessages(null)
    handler.postDelayed({ Log.d(IncomingNotifications.LOG, "timeout $id"); stopSelf() }, if (expiresAt > 0 && ttl > 0) ttl else MAX_MS)
    return START_NOT_STICKY
  }

  private fun startRinging() {
    stopRinging()
    val tone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
    if (tone == null) {
      Log.w(IncomingNotifications.LOG, "системної мелодії немає")
      return
    }
    tone.audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) tone.isLooping = true
    tone.play()
    ringtone = tone
    Log.d(IncomingNotifications.LOG, "ringtone playing=${tone.isPlaying} looping=${if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) tone.isLooping else "n/a"}")
    val vibrator = getSystemService(Vibrator::class.java)
    if (vibrator?.hasVibrator() == true)
      vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600, 1200), 0))
  }

  private fun stopRinging() {
    ringtone?.stop()
    ringtone = null
    getSystemService(Vibrator::class.java)?.cancel()
  }

  override fun onDestroy() {
    Log.d(IncomingNotifications.LOG, "service destroyed $callId")
    handler.removeCallbacksAndMessages(null)
    stopRinging()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val MAX_MS = 60_000L

    /** Зупиняє службу, якщо вона гріє саме цей дзвінок. */
    fun stop(ctx: Context, callId: String) {
      ctx.stopService(Intent(ctx, IncomingCallService::class.java))
    }
  }
}
