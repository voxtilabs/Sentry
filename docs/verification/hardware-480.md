# Hardware opcional para Google Play — 0.3.5 / 12

El AAB v11 no declaraba portrait ni Wi-Fi explícitamente. AAPT confirma sus
requisitos inferidos: orientación portrait de una Activity del escáner de
Google y permiso ACCESS_WIFI_STATE de expo-network. Se declaran ambos como
uses-feature required=false, sin retirar permisos ni modificar el lector NFC,
la cámara, las conexiones o las colas. El helper actualiza entradas existentes
y conserva tools:replace para evitar que una biblioteca las vuelva obligatorias.

Se incorpora un guardia al workflow manual de AAB que valida el manifiesto
combinado después de compilar, antes de publicar el artefacto. Comprueba los
siete usos opcionales del producto, incluidos los dos reportados por Play.

Verificación local: 104 pruebas móviles, tipos, puente y lint aprobados.
Las tres regresiones de hardware fallaron antes del arreglo. Prebuild y
processReleaseResources con Gradle real aprobados; el XML combinado supera
el guardia. AAPT sobre el paquete de recursos compilado declara portrait y
wifi como uses-feature-not-required y deja de inferirlos como obligatorios.
El guardia también rechaza el manifiesto original del AAB v11.

El cambio no requiere desplegar API/web. Se genera un único AAB firmado nuevo
con versionCode 12 porque 11 ya fue subido a Play. La corrección nativa NFC
que el usuario probó en el teléfono se conserva.

[Android: funciones inferidas de los permisos](https://developer.android.com/guide/topics/manifest/uses-feature-element).
[Android: reglas de combinación del manifiesto](https://developer.android.com/build/manage-manifests).
