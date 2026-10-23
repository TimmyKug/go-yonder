package expo.modules.yonderdevicehealth

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the state Android uses to decide whether to throttle or kill the app,
 * and the reasons recorded for its earlier process exits. Every function is
 * synchronous and never throws for a missing API level.
 */
class YonderDeviceHealthModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("YonderDeviceHealth")

    Function("getPowerState") {
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val usage = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
      mapOf(
        "ignoringBatteryOptimizations" to (power?.isIgnoringBatteryOptimizations(context.packageName) ?: false),
        "backgroundRestricted" to (
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) activity?.isBackgroundRestricted ?: false else false
          ),
        "standbyBucket" to (
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) usage?.appStandbyBucket else null
          )
      )
    }

    Function("getProcessExits") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        return@Function emptyList<Map<String, Any?>>()
      }
      val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        ?: return@Function emptyList<Map<String, Any?>>()
      activity.getHistoricalProcessExitReasons(null, 0, 0).map { exit ->
        mapOf(
          "timestampMs" to exit.timestamp.toDouble(),
          "reason" to exit.reason,
          "status" to exit.status,
          "importance" to exit.importance,
          "pssKb" to exit.pss.toDouble(),
          "rssKb" to exit.rss.toDouble(),
          "description" to exit.description
        )
      }
    }

    Function("canPostNotifications") {
      canPostNotifications()
    }

    // Optimized apps can be exempted with the system dialog; restricted ones
    // only from the app's own settings page.
    Function("openBatterySettings") { backgroundRestricted: Boolean ->
      val packageUri = Uri.parse("package:${context.packageName}")
      val intents = buildList {
        if (!backgroundRestricted) {
          add(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri))
        }
        add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
      }
      intents.any { intent -> startActivity(intent) }
    }

    Function("showNotification") { id: Int, title: String, body: String, url: String ->
      if (!canPostNotifications()) {
        return@Function false
      }
      ensureChannel()
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val contentIntent = PendingIntent.getActivity(
        context,
        id,
        open,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(notificationIcon())
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
      try {
        NotificationManagerCompat.from(context).notify(id, notification)
        true
      } catch (e: SecurityException) {
        false
      }
    }
  }

  private fun canPostNotifications(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHANNEL_ID, "Tracking problems", NotificationManager.IMPORTANCE_DEFAULT)
      channel.description = "Warnings about settings that can stop background tracking"
      manager.createNotificationChannel(channel)
    }
  }

  // The same icon the location foreground service uses.
  private fun notificationIcon(): Int {
    return context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon
  }

  private fun startActivity(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (e: Exception) {
      false
    }
  }

  companion object {
    private const val CHANNEL_ID = "yonder-tracking-problems"
  }
}
