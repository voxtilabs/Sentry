package cl.voxtilabs.sentryocr

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** Cola privada del dispositivo. Solo se borra después del acuse del servidor. */
class ReferenceGpsStore(context: Context) : SQLiteOpenHelper(context, "reference-gps-v1.db", null, 1) {
  init { setWriteAheadLoggingEnabled(true) }
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE points(walk_id TEXT NOT NULL,point_id TEXT NOT NULL,recorded_ms INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(walk_id,point_id))")
    db.execSQL("CREATE INDEX points_order ON points(walk_id,recorded_ms)")
  }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
  fun put(walkId: String, point: JSONObject, timestamp: Long) {
    val values = ContentValues().apply {
      put("walk_id", walkId); put("point_id", point.getString("clientPointId"))
      put("recorded_ms", timestamp); put("payload", point.toString())
    }
    writableDatabase.insertOrThrow("points", null, values)
  }
  fun pending(walkId: String): JSONArray {
    val result = JSONArray()
    readableDatabase.query("points", arrayOf("payload"), "walk_id=?", arrayOf(walkId), null, null, "recorded_ms", "50").use { rows ->
      while (rows.moveToNext()) result.put(JSONObject(rows.getString(0)))
    }
    return result
  }
  fun count(walkId: String): Int = DatabaseUtils.longForQuery(readableDatabase,
    "SELECT count(*) FROM points WHERE walk_id=?", arrayOf(walkId)).toInt()
  fun acknowledge(walkId: String, ids: List<String>) {
    if (ids.isEmpty()) return
    require(ids.size <= 50)
    writableDatabase.delete("points", "walk_id=? AND point_id IN (${ids.joinToString(",") { "?" }})",
      (listOf(walkId) + ids).toTypedArray())
  }
}
