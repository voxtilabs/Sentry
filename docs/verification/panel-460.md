# Supervisor: operación e informes (#460)

## Comportamiento

- El recorrido abierto se actualiza cada 5 segundos mientras la pestaña está visible, igual que las tarjetas. Las consultas no se superponen, las que quedan atascadas se cancelan y se reintenta tras recuperar conexión. No se recarga el documento ni se reinicia el mapa en cada lectura.
- Informes recientes muestra todos los recintos autorizados, con filtro reversible, fechas locales, paginación y estado/cumplimiento. El resumen por recinto ofrece versiones con y sin fotos. Las fechas sin hora incluyen el día final completo en la zona del recinto; los timestamps conservan el fin exclusivo del contrato anterior.
- ADMIN y SUPERVISOR gestionan destinatarios adicionales por recinto. El supervisor solo puede consultar/modificar sus asignados. Se conservan los otros overrides y los envíos automáticos a administradores.
- Los supervisores pueden crear guardias en sus recintos, sin poder crear administradores u otros supervisores. La función SQL específica comprueba actor activo, membresía y asignación; el rol creado está fijado a GUARDIA. No se simula un actor ADMIN para reutilizar la función antigua.
- Los límites iniciales son 20 guardias activos por empresa y 20 por recinto; el administrador los configura en Reglas. El máximo del plan sigue aplicándose. Creación, activación y asignación serializan comprobaciones para no superar cupos con solicitudes concurrentes. Las asignaciones ya existentes son idempotentes.
- RUT es un campo opcional junto a Nombre y Apellido al crear un usuario Guardia, y se puede corregir/quitar en su ficha. No interviene en el acceso ni aparece en el selector de la app o en los PDF de ronda. Se normaliza y valida el dígito verificador. Se cifra con AES-GCM, nonce aleatorio y AAD enlazado a empresa/usuario; se consulta únicamente al abrir una ficha autorizada. El listado solo informa si está registrado. Tabla con tenant_id, RLS habilitado/forzado y FK de borrado en cascada. Lecturas y cambios auditados sin el valor; respuestas no-store. La eliminación del dato y el cambio a otro rol retiran su copia activa.
- El resumen inicial distingue actividad reciente de acumulados: rondas completadas/incompletas y cumplimiento de las últimas 24 horas, guardias activos y rondas abiertas. Se refresca parcialmente cada 30 segundos. La pantalla de ubicación consulta el consentimiento real en vez de afirmar que está vigente sin comprobarlo.
- El PDF comprimido es la copia que se persiste y descarga/envía. Una caché antigua que supere el presupuesto se regenera y reemplaza antes del envío. Los originales fotográficos y sus huellas permanecen como evidencia independiente.

## Verificación previa

Regresiones reproducidas antes: la traza abierta no hacía nuevas consultas después del montaje; las métricas recientes faltaban; toBuffer reutilizaba una caché que excedía el presupuesto. Se verificaron fallando y luego pasando.

2.772 pruebas unitarias API y 999 web correctas, tipos/lint/build. Navegador local a 1440 y 390 px: actualización sin recarga, todos los informes → filtro → limpiar, descarga con fotos, destinatarios conservados, creación de guardia y RUT opcional en el formulario del administrador; sin desbordamiento horizontal. Las capturas usan datos de prueba y permanecen fuera del repositorio.

PostgreSQL real, rol de aplicación y transacciones revertidas: cifrado/borrado del RUT, aislamiento entre empresas, fechas/paginación, destinatarios que conservan otras reglas, límite de empresa y de recinto. Alta mediante un supervisor real de la transacción: membresía GUARDIA, recinto autorizado y RUT de prueba; la función SQL rechaza un recinto ajeno con 42501. Ninguna ronda, consentimiento o correo creado por estas verificaciones. La integración equivalente queda en operations.integration.spec.ts para la base demo.

Resumen real de un día de Maquinaria: 2.496 bytes sin fotos; 3.353.501 bytes y 41 imágenes con fotos. El rango incluye exactamente ese día en America/Santiago. Los PDF y datos de clientes quedan fuera de GitHub.

## Diagnóstico GPS solicitado

Se congeló el corte de la solicitud original: rondas anteriores al 15/11/2026 en horario de Santiago. Se revisaron 15 rondas. Los peores grupos se concentran en la noche del 13 y la madrugada del 14: las rondas de 21, 23 y 01 horas presentan aproximadamente 84%, 61% y 44% de lecturas con precisión declarada peor que el máximo de 20 m. El día anterior, las rondas iniciadas a las 21/23 tenían solo 5–6%; no es una falla demostrada a la misma hora cada día. Una ronda anterior a la actualización también tiene calidad muy baja.

El identificador de dispositivo es el mismo en las rondas firmadas; las posiciones persistidas llegan con mediana de alrededor de 1–2 segundos incluso en los grupos malos. El reporte más reciente confirma app 0.3.3, Android API 35 y fondo concedido, pero es posterior al tramo defectuoso y no prueba qué permiso había en cada instante histórico. No hay batería ni telemetría de satélites en estas muestras. No se encontró un cambio horario del servidor que explique la degradación; no se atribuye a ahorro programado, ambiente o receptor sin más evidencia. El tablero avisa según el máximo efectivo del recinto, sin inventar una causa física. No se modifican coordenadas, escaneos ni etiquetas para simular un trazado mejor.

## Privacidad y despliegue

RUT se limita a identificación laboral opcional y acceso acotado. Se actualiza la política pública del producto en su rama de landing para conservar las Condiciones del Servicio ya publicadas. La URL histórica /privacidad del portal redirige a la política pública; no se alteran avisos aceptados ni se fuerza una reaceptación por corregir un enlace. Referencia primaria consultada: [Ley 19.628 vigente](https://www.bcn.cl/leychile/N?f=2023-05-09&i=141599) y [Ley 21.719, vigencia desde el 1 de diciembre de 2026](https://www.bcn.cl/balance-legislativo/detalle/ficha_LEY_21719_2024-12-13). Estos controles no sustituyen las decisiones del responsable sobre finalidad y conservación.

Las dos migraciones son aditivas; no cambian datos históricos. Deploy manual API/web después de comprobar rondas y cierres pendientes en todas las empresas. El panel sigue pendiente de publicación mientras hay una ronda activa; la landing legal ya responde públicamente. No APK/AAB, no Actions y no reinicio de PostgreSQL/Redis. El propietario autorizó explícitamente fusionar los PR con su cuenta BrunoAle-115 sin esperar revisores; se integraron los 12 PR pendientes a staging sin conflictos, conservando las protecciones del repositorio y sin nuevas ejecuciones de Actions.


## Configuración aplicada sin reiniciar

Se añadieron cuatro guardias faltantes y siete asignaciones de la nómina vigente de CASA MATRIZ y MAQUINARIA, con coincidencias existentes preservadas y sin inventar RUT ni aceptar consentimientos. Se agregó el destinatario adicional solicitado a las tres empresas Janssen y sus cuatro recintos activos, conservando los destinatarios previos y las demás reglas. Los límites de guardias quedan en 20 por empresa y 20 por recinto, configurables por el administrador. Los nombres, credenciales, correos y datos de rondas se guardan solo en el expediente privado de operación.

En la revisión final se reprodujo y corrigió una omisión de navegación: ADMIN tenía el permiso de destinatarios pero carecía del enlace para llegar a la pantalla. La regresión falla antes del enlace y pasa para ADMIN/SUPERVISOR después.
