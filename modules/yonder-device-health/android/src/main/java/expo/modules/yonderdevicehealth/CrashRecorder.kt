package expo.modules.yonderdevicehealth

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/**
 * Keeps the stack trace of an uncaught exception, which Android's exit records
 * leave out for Java crashes. The handler is installed by [CrashRecorderProvider]
 * when the process starts, before the app or any JavaScript loads.
 */
object CrashRecorder {
  private const val PREFERENCES = "yonder-crashes"
  private const val ENTRIES_KEY = "entries"
  private const val MAX_ENTRIES = 5
  private const val MAX_FRAMES = 8
  private const val MAX_TEXT_LENGTH = 300

  private var installed = false
  private var processStartedAtMs = 0L

  fun install(context: Context) {
    if (installed) return
    installed = true
    processStartedAtMs = System.currentTimeMillis()
    val appContext = context.applicationContext ?: context
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        record(appContext, thread, error)
      } catch (_: Throwable) {
        // Recording must never hide the crash.
      }
      previous?.uncaughtException(thread, error)
    }
  }

  private fun record(context: Context, thread: Thread, error: Throwable) {
    var root = error
    while (root.cause != null && root.cause !== root) {
      root = root.cause!!
    }
    val entry = JSONObject()
      .put("atMs", System.currentTimeMillis())
      .put("processStartedAtMs", processStartedAtMs)
      .put("thread", thread.name.take(MAX_TEXT_LENGTH))
      .put("exception", describe(error))
      .put("cause", if (root === error) JSONObject.NULL else describe(root))
      .put(
        "frames",
        JSONArray(root.stackTrace.take(MAX_FRAMES).map { it.toString().take(MAX_TEXT_LENGTH) })
      )
    val entries = readEntries(context)
    entries.put(entry)
    val kept = JSONArray()
    for (index in maxOf(0, entries.length() - MAX_ENTRIES) until entries.length()) {
      kept.put(entries.get(index))
    }
    // The process is about to die, so write synchronously.
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
      .putString(ENTRIES_KEY, kept.toString())
      .commit()
  }

  private fun describe(error: Throwable): String {
    val message = error.message?.let { ": $it" } ?: ""
    return (error.javaClass.name + message).take(MAX_TEXT_LENGTH)
  }

  private fun readEntries(context: Context): JSONArray {
    val stored = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getString(ENTRIES_KEY, null) ?: return JSONArray()
    return try {
      JSONArray(stored)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  /** Forgets the crashes recorded at or before [atMs], once they are saved elsewhere. */
  fun clearThrough(context: Context, atMs: Long) {
    val entries = readEntries(context)
    val kept = JSONArray()
    for (index in 0 until entries.length()) {
      val entry = entries.optJSONObject(index) ?: continue
      if (entry.optLong("atMs") > atMs) kept.put(entry)
    }
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
      .putString(ENTRIES_KEY, kept.toString())
      .commit()
  }

  /** Returns the recorded crashes, oldest first, keeping them until [clearThrough]. */
  fun peek(context: Context): List<Map<String, Any?>> {
    val entries = readEntries(context)
    return (0 until entries.length()).mapNotNull { index ->
      val entry = entries.optJSONObject(index) ?: return@mapNotNull null
      val frames = entry.optJSONArray("frames")
      mapOf(
        "atMs" to entry.optLong("atMs").toDouble(),
        "processStartedAtMs" to entry.optLong("processStartedAtMs").toDouble(),
        "thread" to entry.optString("thread"),
        "exception" to entry.optString("exception"),
        "cause" to if (entry.isNull("cause")) null else entry.optString("cause"),
        "frames" to (0 until (frames?.length() ?: 0)).map { frames!!.optString(it) }
      )
    }
  }
}

/** Runs in every process before Application.onCreate to install [CrashRecorder]. */
class CrashRecorderProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    context?.let { CrashRecorder.install(it) }
    return true
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = 0
}
