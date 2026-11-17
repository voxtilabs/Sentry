# Recuperación NFC Android — 0.3.4 / versionCode 11

Se reprodujeron fallos del lector nativo de `react-native-nfc-manager` 3.17.2,
compilando en JVM el cuerpo real de su callback y de su cancelación. No son una
atribución confirmada a los teléfonos que reportaron el problema: no había
reportes históricos disponibles y no había un teléfono conectado por ADB durante
esta verificación.

## Defectos reproducidos y corrección

- El callback bloqueaba la instancia anónima de `ReaderCallback`, mientras la
  cancelación bloqueaba `NfcManager`. Una cancelación entre la comprobación y el
  acceso a `techRequest` provocaba `NullPointerException`. Ambos caminos ahora
  usan el monitor del mismo manager.
- Las excepciones de Android durante el descubrimiento escapaban del callback.
  Se reprodujeron un handle de etiqueta vencido (`SecurityException`) y una
  referencia NDEF ausente. El callback ahora recupera la solicitud y permite
  reintentar, sin registrar identificadores ni contenido de la etiqueta.
- Un inicio o cierre tardío del lector de login podía cancelar una solicitud
  posterior. Cada sesión ahora conserva su propia cancelación y el escaneo de
  puntos espera su limpieza nativa antes de comenzar.
- El gestor JS esperaba consultar el registro de Android antes de crear su
  solicitud. Cancelar durante esa espera permitía crear una solicitud huérfana
  después del cierre. Se reproduce con el gestor JS instalado y se invalida
  mediante una generación comprobada antes de crear la solicitud nativa.

`Util.messageToJSON` ya toleraba un mensaje NDEF cacheado nulo. Ese caso aislado
no se presenta como causa del incidente.

## Lectura al pulsar Escanear

La reserva de despacho NFC de Android se conserva mientras SentryCore está en
primer plano. Sin una solicitud activa, el callback vuelve antes de consultar
tecnologías, UID, convertir una etiqueta, conectarse o emitir un evento. La
pantalla de login conserva su opción de tarjeta; al abandonar esa pantalla se
cancela su lector antes de permitir el de puntos.

Las solicitudes usan las tecnologías físicas y `FLAG_READER_SKIP_NDEF_CHECK`.
SentryCore necesita el UID, no los registros NDEF que podrían dirigir Android a
otra aplicación. Retirar por completo la reserva después de cada escaneo deja
que Android procese esos registros; incluso sin ControlGuard instalado, un AAR
puede abrir Google Play. Esta es la razón para conservar la reserva sin procesar
etiquetas en reposo. [Documentación de Android sobre AAR](https://developer.android.com/develop/connectivity/nfc/nfc#aar),
[banderas del lector](https://developer.android.com/reference/android/nfc/NfcAdapter).

El parche respeta la pausa de la Activity: un callback tardío durante la cámara
se ignora antes de inspeccionar la etiqueta. No se añadieron instrucciones para
forzar el foco, reabrir la Activity o traer la app encima de la cámara.

## Verificación

- Suite móvil completa: 101 pruebas aprobadas; tipos y contrato del puente
  web/nativo aprobados.
- Harness JVM: el callback original falla en cancelación concurrente, handle
  vencido, NDEF ausente, reposo y pausa por cámara. El parche supera los cinco
  casos; el caso de reposo prohíbe consultar `getId`/`getTechList`, convertir,
  conectar, emitir o guardar la etiqueta.
- El parche es idempotente, se prueba sobre el archivo nativo instalado y sobre
  una reconstrucción de la versión original. Rechaza una estructura desconocida
  para evitar una protección omitida en una actualización de la dependencia.
- Las pruebas de reserva ejecutan el gestor JS real de la dependencia y verifican
  que la cancelación de una solicitud temporal sin reserva desregistra el lector,
  y que la reserva explícita evita esa regresión.
- Cuatro pruebas adicionales ejecutan el gestor JS y su clasificación de errores
  reales: muestran la solicitud huérfana original, verifican su cancelación antes
  de llegar a Java y comprueban que salir de login permite el siguiente escaneo.
- Las pruebas existentes de cola offline, cámara y puente siguen pasando. No
  sustituyen una prueba física de ronda, cámara externa y etiquetas del recinto.

El plugin de Expo aplica el parche durante `prebuild`; no depende de conservar
el directorio `android/` ni de editar manualmente `node_modules` en el servidor.
La corrección cambia código Java: requiere distribuir un nuevo APK/AAB. No puede
corregir los teléfonos 0.3.3 mediante un despliegue web.

Para repetir las comprobaciones se requieren las dependencias móviles y un JDK:

```sh
cd apps/mobile
npm test
npm run typecheck
npm run bridge:check
```

La regresión se demuestra ejecutando el callback original en el mismo harness:

```sh
NFC_NATIVE_TEST_NO_PATCH=1 node_modules/.bin/tsx --test \
  --test-name-pattern='patched real Java callback' src/nfc/reader-safety-native.test.ts
```

Ese último comando debe fallar. Los APK de QA usan un paquete separado y una
llave de prueba; el AAB local sin firma no se sube a Google Play. El AAB publicable
debe firmarse con la llave de subida ya existente mediante el flujo habitual.
