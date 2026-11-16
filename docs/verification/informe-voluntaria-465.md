# Ventana horaria de rondas voluntarias (#465)

El plazo técnico de 12 horas que almacena una ronda voluntaria no es una programación del trabajo. El PDF ahora recibe is_voluntary desde PostgreSQL y distingue ambos casos: las voluntarias muestran su tipo, inicio, fin y duración reales; las programadas conservan su ventana horaria. La portada, bitácora y línea de tiempo dejan de presentar el límite interno como un turno. No se cambian el plazo, los controles de sincronización, las horas originales, las anomalías persistidas ni los puntos GPS.

La caché del PDF pasa a formato v2 para que las descargas y el correo no reutilicen el documento con la etiqueta anterior. Se conservan las copias anteriores y las fotos originales; la nueva copia comprimida se persiste con las reglas vigentes. El nombre de descarga se mantiene. La invalidación de caché sigue retirando las dos variantes vigentes, con y sin anexo.

El recinto y la ruta activos de Edificio se renombran por solicitud del propietario, sin cambiar identificadores, secuencia, tareas, NFC o asignaciones. El recinto desactivado contiene seis rondas históricas y no se elimina evidencia: el catálogo administrativo muestra activos inicialmente y permite consultar los inactivos mediante una casilla explícita. Estadísticas, mapa y selección siguen ese filtro; ocultar un recinto también retira su detalle de la pantalla. La app del guardia no cambia.

Verificación: regresión del informe fallando antes y pasando después; 127 pruebas de modelo, primitivas, renderer y servicio. Incluye control positivo de una ronda programada y regeneración frente a una caché del formato anterior. Tipos, lint y builds API/web. Navegador local a 1440/390 px: activos iniciales, consulta reversible de inactivos, cierre del detalle ocultado y sin desbordamiento horizontal. La simulación usa datos de prueba y no modifica clientes.

PDF de la ronda real solicitada: inicio 03:39, fin 03:55, duración 16 minutos, nombre actualizado, mapa y 28 evidencias fotográficas conservadas, alrededor de 2,1 MB. SQL real con rol de aplicación y contexto tenant; documentos y capturas permanecen privados fuera de GitHub. No se envía correo adicional.

Despliegue manual con comprobación previa de rondas y sincronizaciones recientes, desacoplado de la conexión SSH. No requiere APK/AAB, cambios de migración ni reinicio de PostgreSQL/Redis. Integración hacia staging autorizada por el propietario mediante BrunoAle-115 y [skip ci].
