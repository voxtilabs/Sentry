# Correos de rondas y resúmenes programados

El panel **Correos e informes** está disponible para administradores de empresa y supervisores, estos últimos solamente en sus recintos asignados. No modifica la aplicación del guardia ni necesita otro AAB.

## Antes y después

El resumen que se descarga en **Informes** sigue siendo un PDF por recinto y rango: rondas, promedios semanales y por ruta, con fotos opcionales. Era una descarga a petición, sin programación de envío. Se conserva.

La nueva programación envía un resumen agregado en el cuerpo del correo. No concatena PDFs ni manda fotografías, nombres, RUT, respuestas de tareas o posiciones GPS. Los detalles y la evidencia siguen disponibles en el panel con sus permisos habituales.

## Configuración por recinto

- **Solo bajo el mínimo**: una sola alerta con el PDF por destinatario, únicamente si el cumplimiento es estrictamente menor que el umbral configurable. Con mínimo 75%, 75% no alerta y 74% sí. Administradores más lista común, sin duplicados por correo. El modo previo sigue disponible para otras empresas.
- **Lista común**: destinatarios adicionales de alertas y lista base para los resúmenes.
- **Diario, semanal y mensual**: cada frecuencia tiene su interruptor y puede usar la lista común o una lista propia. El mensual puede dirigirse exclusivamente al cliente final. Los administradores no se agregan automáticamente a los resúmenes; deben estar en la lista elegida.
- **Hora local**: desde las 08:00 por defecto, configurable. El programador revisa cada 15 minutos y usa la zona horaria de cada recinto, incluidos cambios de horario.

Las frecuencias están apagadas por defecto. Al activarlas, se procesa el último período completo que ya haya alcanzado la hora de envío. No hay reenvío de todo el historial. Cambiar destinatarios puede entregar ese último período a un destinatario nuevo.

## Contenido y períodos

El diario comprende el día calendario anterior; el semanal, la semana anterior de lunes a domingo; el mensual, el mes calendario anterior. No son ventanas móviles de 24 horas, siete días o treinta días.

Cada correo contiene totales de rondas, cerradas, en curso/pausadas, promedio de cumplimiento de cerradas, cantidad bajo el mínimo y cerradas sin medición. Agrupa por recinto y por días; en el mensual agrupa por semanas, limitando las de los extremos a días del mes. Los promedios no convierten datos faltantes en cero. El umbral es el efectivo al generar el resumen. La pertenencia al período usa el inicio programado, igual que la descarga existente.

El correo es una fotografía de los datos disponibles al generarlo. Una sincronización offline posterior se verá en el panel y no dispara otro resumen del mismo período. No reemplaza el informe detallado ni certifica que una ronda sin medición haya cumplido.

Para no multiplicar envíos, se agrupan los recintos de una misma empresa que coinciden en destinatario, frecuencia, período y zona horaria. El asunto empieza con **SentryCore**, incluye los recintos y el período. Nunca se agrupan empresas diferentes.

## Entrega y privacidad

La cola `report-digest` separa programación de despacho. Los trabajos contienen identificadores y hora, no correos ni evidencia. Cada despacho abre una transacción con `SET LOCAL` mediante `set_config(..., true)` y el mismo rol restringido de la API.

La tabla `report_digest_deliveries` tiene `tenant_id`, RLS habilitado y forzado, política que falla cerrada, y permiso de aplicación solo para leer e insertar. Su clave única conserva la deduplicación aunque se limpie Redis. La cola de correo también usa una clave estable. Un fallo de encolado revierte la transacción para permitir el reintento. Los fallos definitivos se registran sin direcciones ni contenido.

No se enviaron correos reales como parte de las pruebas. Configurar resúmenes aumenta el consumo según cantidad de destinatarios; la configuración no promete eludir cuotas ni garantiza entrega por parte del proveedor.
