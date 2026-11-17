# Pantallas adaptables y revisión R8 (#476)

La app propia deja de fijar portrait: Expo genera MainActivity con
screenOrientation="unspecified" y resizeableActivity="true". Se conservan
configChanges para orientación, tamaño, disposición y smallestScreenSize,
para que cambiar de ventana no recree la Activity por esos cambios.

App usa react-native-safe-area-context ~5.7.0, la versión del catálogo de
Expo57, con Provider estable e insets nativos. Una vista interior contiene
también los overlays absolutos de cámara/QR/OCR; así sus controles quedan
dentro del área utilizable. La clave del WebView y la lógica de captura,
GPS, NFC, sesiones y cola offline no se modifican en este ajuste.

Se comprobaron tipos, contrato web/nativo, las 101 pruebas móviles y el
manifiesto generado por prebuild. El APK de verificación se compila release
con R8 y paquete QA separado. No hay un teléfono ADB conectado: falta
verificación física de rotación, cámara externa y NFC del recinto.

## R8

La auditoría anterior al ajuste de insets examinó configuration, seeds,
mapping, usage y DEX de v10 y del APK QA con el fix NFC. Ambos usan R8
8.12.14; la configuración de optimización no cambió. Los 40 métodos NFC
@ReactMethod conservan nombre y anotación, además de sus cinco callbacks de
Activity, postMessage/JavascriptInterface del WebView y entradas JNI auditadas.
No se identificó una eliminación de esos puntos de entrada ni missing_rules.

El DEX v10 muestra el bloqueo de la instancia del callback, distinto del
manager que bloquea la cancelación. El DEX corregido bloquea el manager y
conserva las salidas en reposo/pausa y catch RuntimeException. El fallo se
reproduce además sin R8: no se atribuye a la ofuscación sin otro stack.
La compilación exitosa y la auditoría no descartan todo error de ejecución.

[Android: reglas para reflexión y JNI](https://developer.android.com/topic/performance/app-optimization/keep-rule-examples).

## Avisos residuales de Play

React Native/AndroidX conservan llamadas de barras antiguas para compatibilidad
con Android anteriores. La app no configura colores/translucencia por esas
APIs; usa el estilo de StatusBar y los insets. El manifiesto combinado incluye
además una Activity de escáner de Google con orientación propia. No se parchean
a ciegas dependencias del framework o del escáner para ocultar avisos.

La eliminación de la restricción de nuestra Activity y la adaptación de insets
son verificables localmente. No se promete que Play deje de señalar todas las
referencias heredadas de bibliotecas al analizar el AAB.

[Android15: borde a borde y APIs obsoletas](https://developer.android.com/about/versions/15/behavior-changes-15).
[Android16: orientación y ventanas grandes](https://developer.android.com/about/versions/16/behavior-changes-16).

La primera compilación firmada se inició antes de recibir el requisito de
pantallas. Se usa una segunda compilación final para incluirlo; sin disparar
flujos automáticos de CI. Los dos paquetes no son versiones publicadas en Play.

Compilación local final: APK release/R8 aprobado en 6m24s. Se comprobó el
manifiesto del APK, su firma de QA, ausencia de debuggable y presencia en el
bundle de RNCSafeAreaProvider/RNCSafeAreaView y la cancelación NFC corregida;
el DEX conserva el mensaje de recuperación nativa. No reemplaza la firma de
subida del AAB ni la validación física indicada arriba.
