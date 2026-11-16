# Verificación #469 — alertas y resúmenes por correo

Fecha: 16 de noviembre de 2026.

- Compilación de shared, API y web, comprobación de tipos de todos los workspaces y ESLint.
- Regresión: sin el filtro nuevo, fallan los casos 75%, 100% y alerta única bajo 75%; con el filtro pasan. El resto de empresas conserva el comportamiento anterior por defecto.
- Pruebas de despacho, plantillas, rescate, worker y reglas existentes; validación del DTO nuevo para impedir cambios ajenos a correos, campos desconocidos, destinatarios inválidos y valores fuera de rango.
- PostgreSQL local real con rol de aplicación restringido: períodos locales, cambio de hora de Chile, semana que cruza de año, duración de febrero; consolidación por destinatario, listas mensuales independientes y horas distintas entre recintos.
- PostgreSQL: deduplicación durable al repetir un despacho, aislamiento entre empresas y sin contexto; RLS habilitado y forzado; sin UPDATE/DELETE sobre la bitácora ni EXECUTE público de la función de agenda.
- Supervisor asignado puede leer/guardar; un recinto ajeno responde 403 y uno inexistente 404. La escritura conserva parámetros de tareas/fotos y usa la respuesta sin caché del motor de reglas.
- Worker: trabajos por empresa/tick con claves estables; rollback y liberación de conexión cuando falla el encolado, para permitir reintentos.
- Chromium local, 390 y 1365 px: elegir recinto, configurar cliente solo mensual, conservar lista común, guardar cuerpo aceptado por el DTO, sin desbordamiento horizontal. Se inspeccionó la captura móvil.
- No se enviaron correos de prueba a destinatarios reales. Las pruebas de datos revierten sus transacciones. No hay cambios nativos ni nuevo AAB.

Configuración de producción autorizada: solo alertas bajo 75% en las tres empresas Janssen, manteniendo destinatarios; resúmenes apagados inicialmente hasta elegir frecuencia/listas en el panel. El despliegue verifica preparación, acceso de los dos supervisores y conserva PostgreSQL/Redis; la evidencia operacional se guarda fuera del repositorio.
