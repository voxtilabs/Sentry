package cl.voxtilabs.sentryocr

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.util.UUID
import org.json.JSONObject

class ReferenceGpsModule : Module() {
  companion object {
    private var screen: WeakReference<Activity>? = null
    fun releaseScreen() {
      screen?.get()?.let { a -> a.runOnUiThread { a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) } }
      screen = null
    }
  }
  override fun definition() = ModuleDefinition {
    Name("SentryReferenceGps")
    AsyncFunction("command") { raw: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.reject("capture-unavailable", "Captura no disponible", null); return@AsyncFunction }
      try {
        val command = JSONObject(raw)
        val action = command.getString("action")
        val walkId = command.optString("walkId", "")
        if (walkId.isNotEmpty()) UUID.fromString(walkId)
        when (action) {
          "start" -> {
            if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
              promise.reject("precise-location-required", "Activa la ubicación precisa", null); return@AsyncFunction
            }
            val locations = context.getSystemService(android.content.Context.LOCATION_SERVICE) as LocationManager
            if (!locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
              promise.reject("gps-disabled", "Activa el GPS del teléfono", null); return@AsyncFunction
            }
            require(walkId.isNotEmpty())
            val duration = command.getInt("maxDurationSeconds")
            require(duration in 60..14400)
            val current = ReferenceGpsService.current
            if (current != null && current.walkId != walkId) {
              promise.reject("another-capture-active", "Finaliza la captura activa", null); return@AsyncFunction
            }
            ReferenceGpsService.lastError = null
            appContext.currentActivity?.let { a ->
              screen = WeakReference(a)
              a.runOnUiThread { a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            }
            val intent = Intent(context, ReferenceGpsService::class.java).putExtra("walkId", walkId).putExtra("duration", duration)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            val main = Handler(Looper.getMainLooper())
            var attempts = 0
            val check = object : Runnable {
              override fun run() {
                val active = ReferenceGpsService.current?.walkId == walkId
                if (active || ReferenceGpsService.lastError != null || attempts++ > 60) {
                  promise.resolve(ReferenceGpsService.snapshot(context, walkId).toString())
                } else main.postDelayed(this, 50)
              }
            }
            main.post(check)
          }
          "stop" -> {
            if (walkId.isEmpty() || ReferenceGpsService.current?.walkId == walkId) context.stopService(Intent(context, ReferenceGpsService::class.java))
            releaseScreen()
            promise.resolve(ReferenceGpsService.snapshot(context, walkId).put("active", false).toString())
          }
          "pending" -> ReferenceGpsStore(context).use { store ->
            require(walkId.isNotEmpty())
            promise.resolve(ReferenceGpsService.snapshot(context, walkId).put("points", store.pending(walkId)).toString())
          }
          "ack" -> ReferenceGpsStore(context).use { store ->
            require(walkId.isNotEmpty())
            val values = command.getJSONArray("pointIds")
            require(values.length() <= 50)
            val ids = (0 until values.length()).map { values.getString(it).also { id -> UUID.fromString(id) } }
            store.acknowledge(walkId, ids)
            promise.resolve(ReferenceGpsService.snapshot(context, walkId).toString())
          }
          "state" -> promise.resolve(ReferenceGpsService.snapshot(context, walkId).toString())
          else -> promise.reject("invalid-command", "Comando no válido", null)
        }
      } catch (_: Exception) {
        promise.reject("capture-failed", "No se pudo ejecutar la captura", null)
      }
    }
  }
}
