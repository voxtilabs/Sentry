package cl.voxtilabs.sentryocr

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SentryExitInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SentryExitInfo")

    AsyncFunction("previousExit") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@AsyncFunction null
      val activityManager = context.getSystemService(ActivityManager::class.java)
        ?: return@AsyncFunction null
      val record = activityManager.getHistoricalProcessExitReasons(context.packageName, 0, 24)
        .firstOrNull { it.processName == context.packageName }
        ?: return@AsyncFunction null
      val cause = when (record.reason) {
        ApplicationExitInfo.REASON_CRASH -> "java_crash"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "native_crash"
        ApplicationExitInfo.REASON_ANR -> "anr"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "resource_limit"
        ApplicationExitInfo.REASON_SIGNALED -> "signal"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
        ApplicationExitInfo.REASON_OTHER, ApplicationExitInfo.REASON_UNKNOWN -> "unspecified"
        else -> "expected"
      }
      // Android descriptions and tombstones can contain unrelated data. Send only
      // the documented reason and numeric diagnostics for this app's main process.
      mapOf("cause" to cause, "timeMs" to record.timestamp, "status" to record.status, "importance" to record.importance)
    }
  }
}
