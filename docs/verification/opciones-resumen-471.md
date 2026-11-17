# Verificación #471 — fotos y nombres opcionales en resúmenes

El propietario confirmó que «datos personales» significa solo nombre y apellido, sin RUT.

- Seis reglas en catálogo compartido: fotos y nombres independientes por frecuencia, apagadas por defecto y editables por empresa/recinto. El endpoint existente conserva autorización de administrador/supervisor asignado y rechaza campos no declarados, incluido un intento de incluir RUT.
- PDF real: se probaron las cuatro combinaciones de fotos/nombres, incluidos los pies de fotografías. Se extrajeron los operandos de texto de sus streams comprimidos; el nombre de la persona de prueba aparece solo al activarlo. La consulta SQL tampoco selecciona nombres si están apagados.
- Regresión: forzar el comportamiento anterior, que incluía nombres incondicionalmente, hace fallar los dos casos con nombres desmarcados. Al restaurar el cambio pasan.
- Se reutilizan los PDFs únicamente entre opciones idénticas; pruebas de aislamiento de modos y presupuesto conjunto de adjuntos. Se comprime por recinto y se detiene la generación al superar el presupuesto. Exceder peso/cantidad conserva el correo compacto con aviso y enlace al panel autenticado; los errores inesperados provocan reintento.
- PostgreSQL real con rol restringido y rollback: guardar opciones como supervisor de su recinto, rechazar otro recinto, incluir nombres en diario y omitirlos en mensual; generar el PDF real y comprobar su texto. Las fotos originales no se alteran.
- Chromium local a 390 y 1365 px: casillas independientes, persistencia tras recargar, aislamiento por frecuencia y descarga manual con `guardNames=false`, sin desbordamiento horizontal.
- 42 pruebas unitarias de API, 5 de PostgreSQL y 24 de web. Tipos, lint y compilaciones de shared/API/web. Las rutas temporales del navegador se eliminaron antes de compilar.
- Sin correos reales de prueba, sin cambios nativos y sin nuevo AAB. Se conserva el umbral y las listas de #469; la publicación no habilita automáticamente frecuencias ni contenido personal.
