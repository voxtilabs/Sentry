package cl.voxtilabs.sentryocr

import android.app.*
import android.content.Context
import android.content.Intent
import android.hardware.*
import android.location.*
import android.os.*
import com.google.android.gms.location.*
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executor
import kotlin.math.sqrt
import org.json.JSONArray
import org.json.JSONObject

/** GNSS continuo y sensores a 200 Hz, únicamente durante una captura explícita. */
class ReferenceGpsService : Service(), SensorEventListener, android.location.LocationListener {
  companion object {
    @Volatile var current: ReferenceGpsService? = null
    @Volatile var lastError: String? = null
    private const val CHANNEL = "sentry-reference-gps"
    private const val NOTIFICATION = 6914
    fun snapshot(context: Context, requested: String): JSONObject {
      val service = current
      val fix = service?.latest?.takeIf { System.currentTimeMillis() - it.time in 0..5000 }
      val scope = requested.ifEmpty { service?.walkId ?: "" }
      val pending = if (scope.isEmpty()) 0 else ReferenceGpsStore(context).use { it.count(scope) }
      return JSONObject().put("active", service != null && service.walkId.isNotEmpty())
        .put("walkId", service?.walkId ?: JSONObject.NULL)
        .put("accuracyM", fix?.accuracy ?: JSONObject.NULL)
        .put("speedMps", fix?.let { if (it.hasSpeed() && it.speed >= 0) it.speed else null } ?: JSONObject.NULL)
        .put("satellitesUsed", service?.satellites ?: 0)
        .put("accelerometer", service?.hasAccel ?: false).put("gyroscope", service?.hasGyro ?: false)
        .put("accelSamples", service?.accelTotal ?: 0L).put("gyroSamples", service?.gyroTotal ?: 0L)
        .put("fullGnss", service?.fullGnss ?: false).put("pending", pending).put("points", JSONArray())
        .put("error", lastError ?: JSONObject.NULL)
    }
  }
  @Volatile var walkId = ""
  @Volatile var latest: Location? = null
  @Volatile var satellites = 0
  @Volatile var hasAccel = false
  @Volatile var hasGyro = false
  @Volatile var fullGnss = false
  @Volatile var accelTotal = 0L
  @Volatile var gyroTotal = 0L
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private lateinit var locations: LocationManager
  private lateinit var sensors: SensorManager
  private lateinit var fused: FusedLocationProviderClient
  private lateinit var store: ReferenceGpsStore
  private var wake: PowerManager.WakeLock? = null
  private var deadline = 0L
  private var running = false
  private var savedAt = 0L
  private var accelSquared = 0.0
  private var gyroSquared = 0.0
  private var accelCount = 0
  private var gyroCount = 0
  private val gravity = DoubleArray(3)
  private var gravityInitialized = false
  private var accelType = Sensor.TYPE_LINEAR_ACCELERATION
  private val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
  private val gpsStatus = object : GnssStatus.Callback() {
    override fun onSatelliteStatusChanged(status: GnssStatus) {
      satellites = (0 until status.satelliteCount).count { status.usedInFix(it) }
    }
  }
  private val measurements = object : GnssMeasurementsEvent.Callback() {}
  private val fusedCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) { result.locations.forEach { onLocationChanged(it) } }
  }
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate()
    thread = HandlerThread("reference-gps", Process.THREAD_PRIORITY_MORE_FAVORABLE).apply { start() }
    handler = Handler(thread.looper)
    locations = getSystemService(LOCATION_SERVICE) as LocationManager
    sensors = getSystemService(SENSOR_SERVICE) as SensorManager
    fused = LocationServices.getFusedLocationProviderClient(this)
    store = ReferenceGpsStore(this)
  }
  private fun notification(): Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Ronda patrón", NotificationManager.IMPORTANCE_LOW))
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val stop = PendingIntent.getService(this, 1, Intent(this, ReferenceGpsService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    builder.setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Ronda patrón · GPS máxima precisión")
      .setContentText("GNSS continuo, acelerómetro y giroscopio activos").setOngoing(true)
      .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Detener captura", stop).build())
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(PendingIntent.getActivity(this, 2, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    return builder.build()
  }
  @Suppress("MissingPermission")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "STOP") { stopSelf(); return START_NOT_STICKY }
    if (running) return START_NOT_STICKY
    walkId = intent?.getStringExtra("walkId") ?: ""
    if (walkId.isEmpty()) { stopSelf(); return START_NOT_STICKY }
    val duration = intent!!.getIntExtra("duration", 7200).coerceIn(60, 14400)
    try {
      startForeground(NOTIFICATION, notification())
      deadline = SystemClock.elapsedRealtime() + duration * 1000L
      wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SentryCore:referenceGPS").apply { acquire(duration * 1000L + 5000) }
      running = true; current = this
      handler.post {
        try {
          val accel = sensors.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) ?: sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
          accel?.let { accelType = it.type; hasAccel = sensors.registerListener(this, it, 5000, 0, handler) }
          sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { hasGyro = sensors.registerListener(this, it, 5000, 0, handler) }
          val request = com.google.android.gms.location.LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
            .setMinUpdateIntervalMillis(500L).setMinUpdateDistanceMeters(0f)
            .setWaitForAccurateLocation(true).setMaxUpdateDelayMillis(0).setMaxUpdateAgeMillis(0).build()
          fused.requestLocationUpdates(request, fusedCallback, thread.looper)
          locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, thread.looper)
          locations.registerGnssStatusCallback(gpsStatus, handler)
          if (Build.VERSION.SDK_INT >= 31) {
            try {
              fullGnss = locations.registerGnssMeasurementsCallback(GnssMeasurementRequest.Builder().setFullTracking(true).build(), Executor { handler.post(it) }, measurements)
            } catch (_: Exception) { fullGnss = false }
          }
          handler.post(tick)
        } catch (_: Exception) { lastError = "capture-failed"; stopSelf() }
      }
    } catch (_: Exception) { lastError = "capture-failed"; stopSelf() }
    return START_NOT_STICKY
  }
  override fun onLocationChanged(location: Location) {
    if (!running || !location.hasAccuracy() || !location.accuracy.isFinite() || location.accuracy <= 0) return
    if (!location.latitude.isFinite() || !location.longitude.isFinite()) return
    val old = latest
    if (old == null || location.time > old.time + 500 || (location.time >= old.time - 500 && location.accuracy < old.accuracy)) latest = Location(location)
  }
  override fun onProviderEnabled(provider: String) = Unit
  override fun onProviderDisabled(provider: String) = Unit
  @Deprecated("Compatibilidad Android")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  override fun onSensorChanged(event: SensorEvent) {
    if (!running) return
    if (event.values.size < 3 || event.values.take(3).any { !it.isFinite() }) return
    if (event.sensor.type == Sensor.TYPE_GYROSCOPE) {
      gyroSquared += event.values.take(3).sumOf { it.toDouble() * it.toDouble() }; gyroCount++; gyroTotal++
    } else if (event.sensor.type == accelType) {
      if (!gravityInitialized) { for (i in 0..2) gravity[i] = event.values[i].toDouble(); gravityInitialized = true }
      var energy = 0.0
      for (i in 0..2) {
        val raw = event.values[i].toDouble()
        val linear = if (accelType == Sensor.TYPE_LINEAR_ACCELERATION) raw else { gravity[i] = gravity[i] * 0.95 + raw * 0.05; raw - gravity[i] }
        energy += linear * linear
      }
      accelSquared += energy; accelCount++; accelTotal++
    }
  }
  private val tick = object : Runnable {
    override fun run() {
      if (!running) return
      if (SystemClock.elapsedRealtime() >= deadline) { stopSelf(); return }
      val accel = if (accelCount > 0) sqrt(accelSquared / accelCount) / SensorManager.GRAVITY_EARTH else null
      val gyro = if (gyroCount > 0) sqrt(gyroSquared / gyroCount) else null
      val stationary = accelCount >= 20 && gyroCount >= 20 && accel != null && gyro != null && accel < 0.04 && gyro < 0.08
      val fix = latest
      if (fix != null && fix.time > savedAt && System.currentTimeMillis() - fix.time in 0..5000) {
        val point = JSONObject().put("clientPointId", UUID.randomUUID().toString())
          .put("recordedAt", formatter.format(Date(fix.time))).put("latitude", fix.latitude).put("longitude", fix.longitude)
          .put("accuracyM", fix.accuracy.toDouble()).put("stationary", stationary)
          .put("accelSamples", accelCount).put("gyroSamples", gyroCount).put("satellitesUsed", satellites)
        accel?.let { point.put("accelRmsG", it) }; gyro?.let { point.put("gyroRmsRadS", it) }
        if (fix.hasSpeed() && fix.speed.isFinite() && fix.speed >= 0) point.put("speedMps", fix.speed.toDouble())
        if (fix.hasBearing() && fix.bearing.isFinite()) point.put("heading", fix.bearing.toDouble())
        try { store.put(walkId, point, fix.time); savedAt = fix.time } catch (_: Exception) { lastError = "storage-failed"; stopSelf(); return }
      }
      accelSquared = 0.0; gyroSquared = 0.0; accelCount = 0; gyroCount = 0
      handler.postDelayed(this, 1000)
    }
  }
  override fun onTaskRemoved(rootIntent: Intent?) { stopSelf(); super.onTaskRemoved(rootIntent) }
  override fun onDestroy() {
    running = false; current = null
    handler.removeCallbacksAndMessages(null)
    runCatching { sensors.unregisterListener(this) }
    runCatching { locations.removeUpdates(this) }
    runCatching { locations.unregisterGnssStatusCallback(gpsStatus) }
    runCatching { locations.unregisterGnssMeasurementsCallback(measurements) }
    runCatching { fused.removeLocationUpdates(fusedCallback) }
    runCatching { if (wake?.isHeld == true) wake?.release() }
    store.close(); thread.quitSafely(); ReferenceGpsModule.releaseScreen()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
