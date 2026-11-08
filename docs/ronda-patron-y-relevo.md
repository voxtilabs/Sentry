# Ronda patrón y relevo de guardias

La app 0.3.2 incorpora el protocolo aditivo 1.7. La web sigue funcionando con
las versiones anteriores; muestra la opción de actualización cuando el teléfono
no anuncia `gpsReferencia`.

En la app del supervisor, **Ronda patrón** permite instalar primero los NFC desde
**Puntos y etiquetas** y después recorrer una ruta de sus recintos asignados.
El servidor comprueba el consentimiento GPS, la propiedad de la captura y la
asignación del recinto en cada operación. Un guardia no tiene acceso a estos
endpoints. Las rutas sin todos sus NFC instalados no pueden iniciar la captura.

La captura Android usa Fused HIGH_ACCURACY a 1 s (mínimo 500 ms), GPS directo y,
cuando el equipo lo permite, mediciones GNSS con `fullTracking`. Solicita aceleración
y giroscopio a 200 Hz (la frecuencia efectiva depende del equipo) para distinguir reposo y movimiento al calibrar los puntos.
Un servicio en primer plano, notificación con **Detener captura**, bloqueo de
suspensión y pantalla encendida mantienen el muestreo. Android y el hardware
siguen determinando la señal disponible: no se inventa precisión ni se integra
la aceleración como si fuera una coordenada GPS.

Cada posición se guarda primero en SQLite. Se borra de esa cola solo cuando el
servidor confirma su UUID; las lecturas NFC tienen otra cola persistente en la
web. Se puede capturar sin señal una vez iniciada la sesión y sincronizar después.
Finalizar detiene inmediatamente GPS y sensores, y requiere sincronizar toda la
captura antes de cerrarla. Si Android mata el proceso, hay que retomar explícitamente.
El límite predeterminado es de 120 minutos, configurable entre 15 y 240.

El objetivo predeterminado es ±5 m (configurable entre 1 y 50 m). Al escanear se
pide mantener quieto el teléfono unos segundos. Se conservan las muestras y sus
incertidumbres; la estimación del punto no declara una precisión mejor que las
mediciones utilizadas. La ronda patrón queda registrada por separado y **no
reescribe coordenadas de checkpoints ni recorridos históricos**. Su retención
usa los mismos días configurados para las trazas GPS de la empresa.

## Cierres en la app

**TÉRMINO DE RONDA** confirma el recorrido y vuelve al inicio manteniendo abierta
la jornada. Una recarga posterior al último NFC recupera la ronda hasta que se
complete este paso y las tareas pendientes. Las rondas anteriores al cambio se
consideran revisadas para evitar reabrir informes históricos.

**Término de Jornada**, arriba a la derecha del guardia, comprueba los registros,
fotos y respuestas pendientes, marca la salida, revoca la sesión del guardia y
vuelve a la lista de guardias de su empresa. La continuación de empresa queda en
una cookie HttpOnly ligada al dispositivo y con vencimiento; solo permite el
selector de guardias. La tarjeta, empresa y usuarios activos se revalidan.

En el selector, el botón pequeño **Cerrar sesión** revoca también esa continuación.
Los tickets para elegir un guardia son de un uso y duran cinco minutos; el
selector solicita uno nuevo al elegir, para no fallar tras una espera prolongada.
Las colas locales de evidencia se conservan al cambiar de usuario.

## Acceso por código de empresa

La web de la app presenta un código alfanumérico de diez caracteres en mayúsculas.
Abre el mismo selector de guardias que la tarjeta NFC opcional. El enlace
**Acceso de supervisores y administración** conserva usuario y contraseña.
El panel de escritorio mantiene ese formulario como acceso inicial.

El superadmin genera el código al crear una empresa o desde **Código y tarjeta de
empresa**. El administrador y el supervisor con recintos asignados también pueden
renovarlo desde **Acceso de la empresa**. El valor se muestra y se puede copiar
solo al generarlo; la base guarda un HMAC con `LOGIN_CODE_PEPPER`, no el código.
La lectura del estado nunca devuelve la credencial. Renovarlo invalida los
selectores anteriores, incluso después de un relevo. Las sesiones de guardia ya
iniciadas continúan hasta terminar su jornada; si el código cambió, el próximo
ingreso debe identificar nuevamente la empresa.

La autenticación inicial requiere conexión. Una vez iniciada, las rondas y sus
colas de fotos siguen funcionando sin señal. El cambio es compatible con el
puente Android existente y se distribuye mediante la web y la API; no requiere
otro AAB. Los endpoints personales antiguos permanecen para clientes anteriores.

## Cantidad de fotos por tarea

El mínimo y máximo se configuran por tarea. Si ambos son tres, cada tarea exige
tres evidencias propias: dos tareas en el mismo punto requieren seis fotos.
`requiresPhoto` también debe estar activo en las preguntas binarias o de texto.
La configuración de nuevas plantillas puede heredar los valores de la empresa;
los valores explícitos de una tarea tienen prioridad. Al cambiar plantillas en
uso, se crea una nueva versión para conservar las rondas y respuestas históricas.
