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
    AsyncFunction("readAndDelete") { uriString: String, promise: Promise ->
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
            promise.resolve(result.textBlocks.flatMap { it.lines }.map { it.text })
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
