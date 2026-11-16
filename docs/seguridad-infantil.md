# Canal de reportes y respuesta de seguridad infantil

Responsable designado: **Bruno Urrea, service@voxtilabs.cl** (confirmado por el usuario
el 2 de noviembre de 2026). Estándares publicados en `/seguridad-infantil`; el mismo texto
puede consultarse dentro de Ayuda y reportes, sin abandonar la aplicación.

## Recepción y supervisión del canal

`POST /api/feedback` es público para que una persona sin cuenta o con sesión vencida pueda
reportar. Acepta únicamente un UUID de envío, categoría, mensaje y correo opcional de
respuesta. No acepta destinatarios, adjuntos, IDs de tenant o usuario, ni consulta datos
de otras empresas. Por ello omite expresamente el contexto de tenant. La validación de
Origin sigue activa. El límite técnico por IP usa una clave hash con caducidad y no
comparte el bloqueo con los ingresos.

El servidor encola un correo de texto plano en BullMQ/Redis, destinado únicamente a
`SUPPORT_FEEDBACK_EMAIL` (por defecto, el correo confirmado). Redis y su volumen persistente
son necesarios para la recepción. No se agrega una tabla SQL ni se modifica RLS.
El UUID mantiene la idempotencia de un reintento sin cambios de contenido. El folio
significa **recibido para envío**, no que SMTP haya entregado o una persona haya revisado.

El contacto debe revisar el buzón y la cola de correo en el panel SUPERADMIN
(`GET /api/platform/tenants/mail-queue`). Los trabajos fallidos se retienen para diagnóstico
y recuperación, con el evento `mail_dead_letter`; no se debe dar un caso por atendido por
haber obtenido un folio. Si cambia el responsable o buzón, actualizar tanto la configuración
como los estándares públicos y la declaración de Console.

## Atención de un reporte

1. Registrar el folio, fecha, referencia denunciada y estado del caso en un registro
   de acceso restringido al responsable y personal autorizado. No reenviar el reporte
   a listas generales ni pedir que la persona adjunte o reproduzca material de abuso.
2. Priorizar riesgos para menores. No usar este canal como servicio de emergencias.
   Si existe peligro inmediato, acudir a los servicios de emergencia competentes.
3. Verificar la referencia con acceso autorizado y mínimo. Para entrar en datos de una
   empresa desde SUPERADMIN, usar la ventana de soporte con motivo y vencimiento existente;
   no deshabilitar RLS ni consultar indiscriminadamente otros tenants.
4. Si corresponde, restringir o retirar el contenido denunciado y bloquear las cuentas
   responsables, documentando las medidas. No difundir ni descargar copias innecesarias.
5. Ante material de abuso sexual infantil confirmado, coordinar la notificación a la
   autoridad competente y la preservación que exija la legislación aplicable. Consultar
   asesoría jurídica para determinar obligaciones, jurisdicción, autoridad y plazos
   concretos; no inventarlos ni certificar un trámite que no se haya realizado.
6. Responder al correo voluntario cuando sea apropiado, sin revelar evidencia ni datos
   de terceros. El correo de respuesta es declarado por quien reporta, no está verificado
   y no acredita identidad o pertenencia a una empresa.
7. Cerrar y documentar el caso. Revisar la conservación y eliminar datos innecesarios
   cuando terminen las necesidades de atención y las obligaciones legales. Los mensajes
   del buzón y los trabajos retenidos de la cola también contienen datos del reporte.

El responsable debe mantener este proceso operativo antes de certificar su cumplimiento
ante Google. El software facilita recepción y trazabilidad técnica; la revisión de casos,
decisiones y notificaciones a autoridades corresponden al responsable designado.
