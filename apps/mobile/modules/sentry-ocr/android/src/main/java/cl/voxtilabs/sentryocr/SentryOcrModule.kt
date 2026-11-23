package cl.voxtilabs.sentryocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class SentryOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SentryOcr")
    AsyncFunction("readAndDelete") { uriString: String, plateOnly: Boolean, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("OCR_UNAVAILABLE", "No se pudo iniciar la lectura local", null)
        return@AsyncFunction
      }
      val uri = Uri.parse(uriString)
      val file = uri.path?.let { File(it).canonicalFile }
      // El módulo solo lee imágenes temporales de su propia cámara.
      val cache = context.cacheDir.canonicalFile
      if (uri.scheme != "file" || file == null || !file.path.startsWith(cache.path + File.separator)) {
        promise.reject("OCR_INVALID_IMAGE", "Imagen de cámara no válida", null)
        return@AsyncFunction
      }
      val reader = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        val image = InputImage.fromFilePath(context, uri)
        reader.process(image)
          .addOnSuccessListener { result ->
            file.delete()
            // Solo memoria local del shell; el portal recibe un resultado filtrado.
            val lines = result.textBlocks.flatMap { it.lines }
            val visibleLines = if (plateOnly) {
              val rotated = image.rotationDegrees == 90 || image.rotationDegrees == 270
              val width = if (rotated) image.height else image.width
              val height = if (rotated) image.width else image.height
              lines.filter { line ->
                val box = line.boundingBox ?: return@filter false
                box.exactCenterX() in width * 0.05f..width * 0.95f &&
                  box.exactCenterY() in height * 0.22f..height * 0.78f &&
                  box.width() >= width * 0.035f
              }
            } else lines
            val text = visibleLines.map { it.text }.toMutableList()
            if (plateOnly) {
              // ML Kit can return each pair or each glyph as a separate block.
              // Join fragments only along the same physical row, left to right.
              val rows = mutableListOf<MutableList<com.google.mlkit.vision.text.Text.Line>>()
              for (line in visibleLines.sortedBy { it.boundingBox!!.exactCenterY() }) {
                val box = line.boundingBox!!
                val row = rows.lastOrNull()
                val anchor = row?.firstOrNull()?.boundingBox
                if (row != null && anchor != null &&
                  kotlin.math.abs(anchor.exactCenterY() - box.exactCenterY()) < minOf(anchor.height(), box.height()) * 0.65f) {
                  row.add(line)
                } else rows.add(mutableListOf(line))
              }
              for (row in rows.filter { it.size > 1 }) {
                text.add(0, row.sortedBy { it.boundingBox!!.left }.joinToString(" ") { it.text })
              }
            }
            promise.resolve(text)
          }
          .addOnFailureListener {
            file.delete()
            promise.reject("OCR_READ_FAILED", "No se pudo leer el texto; intenta con más luz", null)
          }
          .addOnCompleteListener { reader.close() }
      } catch (_: Exception) {
        file.delete()
        reader.close()
        promise.reject("OCR_READ_FAILED", "No se pudo leer el texto; intenta nuevamente", null)
      }
    }
    AsyncFunction("discard") { uriString: String ->
      val context = appContext.reactContext
      val uri = Uri.parse(uriString)
      val file = uri.path?.let { File(it).canonicalFile }
      if (context != null && uri.scheme == "file" && file != null &&
        file.path.startsWith(context.cacheDir.canonicalPath + File.separator)) file.delete()
    }
  }
}
