# Verificación del panel interno · #454

final result: passed

## Referencia y evidencia

Referencia elegida: `/home/bruno/Descargas/SentryCore-panel-interno-referencias-2026-11-10/propuesta-panel-interno.png` (1487 × 1058 píxeles). El usuario modificó expresamente la dirección: navegación lateral plana, sin fondos de botones, sombras ni gradientes.

Implementación revisada en Chromium local: `http://127.0.0.1:4310`. Capturas privadas en `/tmp/sentry-internal-20261110/`: `ui-admin-1440.png`, `ui-admin-390.png`, `ui-admin-menu-390.png`, y equivalentes `ui-supervisor-*` y `ui-platform-*`. Viewports 1440 × 1024 y 390 × 844 CSS px, densidad 1. La referencia se normalizó a 1440 × 1024 en `design-source-1440.png` (diferencia de aspecto menor al 1%). Comparación completa abierta en la misma entrada junto a la implementación; detalle de navegación comparado con los recortes `design-source-1440-nav.png` y `ui-admin-1440-nav.png`.

## Iteraciones y correcciones

- P2: encabezado duplicado del catálogo hacía envolver la acción principal en móvil. Se simplificó a «Catálogo»; nueva captura confirma título y acción en la misma fila a 390 px.
- P2: selector de recinto en Planificación estiraba la página a 442 px. Encabezados flexibles y selector limitado al ancho disponible; comprobación posterior: 320, 390, 768, 1024 y 1440 px sin desborde de página.
- P2: foco azul sobre barra azul tenía contraste insuficiente. Navegación y cierre del menú usan ahora un contorno del color del texto. La sección actual conserva línea turquesa, texto destacado y `aria-current`.
- Incidencia del entorno de captura: el proveedor de mapas rechaza el origen localhost. Las capturas usan el Referer del dominio autorizado únicamente en el navegador de QA. El código y la clave de producción no cambian. Los mapas finales muestran teselas reales y atribución.
- Las capturas del menú esperan el fin de su entrada de 180 ms; no se evalúa un fotograma parcialmente transparente.

## Revisión de fidelidad

- **Tipografía:** sans serif disponible localmente, jerarquía 28–42 px para encabezados, 13–15 px en controles y contenido. Iconos Tabler de trazo consistente. Textos largos envuelven sin ocultar acciones. Se conserva el nombre comercial real del tenant en lugar del nombre ficticio de la propuesta.
- **Espacio y composición:** barra de 248 px, encabezado de utilidades, espacio de trabajo blanco, métricas en franja con divisores, catálogo y mapa en columnas de escritorio y apilados en móvil. Se conserva un encabezado de catálogo para separar sus acciones y los controles de baja/eliminación ya existentes. Formularios de alta desplegables para dar prioridad a los registros actuales.
- **Color y superficies:** se conserva el white-label existente (azul de cada empresa), con azul noche para plataforma. Navegación sin relleno, radio ni sombra; estado activo con línea y peso tipográfico. Fondos planos y bordes discretos en controles; sin sombras decorativas. Esta diferencia respecto al botón sombreado de la referencia responde al pedido posterior del usuario.
- **Imágenes y activos:** logo existente y mapas geográficos reales, sin imágenes generadas usadas como interfaz, sin mapas ilustrativos ni datos simulados. El mapa centra la ubicación real del recinto, por eso el encuadre difiere de la vista general de Santiago en la propuesta.
- **Contenido:** rótulos en español, datos de empresas y recintos reales, etiquetas de acciones conservadas. La métrica «Con ubicación» describe el dato que existe; no se presenta como un conteo de rutas. No se inventan direcciones o recorridos nativos.

## Interacción y aislamiento

- Las 22 vistas de ADMIN, SUPERVISOR y SUPERADMIN abiertas a 390 px: sin errores JavaScript ni desborde horizontal de la página. Calendarios y tablas conservan su desplazamiento interno.
- Catálogo, planificación y plataforma verificados también a 320, 768, 1024 y 1440 px.
- Buscador de recintos: coincidencia, vacío y restablecimiento. Alta de recinto y empresa: abrir/cerrar; borrador de recinto conservado al reabrir, sin crear registros de prueba en clientes.
- Menú móvil: abrir/cerrar, Escape, contención del foco, retorno al disparador, cierre al pasar a escritorio. Enlaces nativos y estado de página accesible; destinos originales preservados.
- Ayuda abre dentro de la app en los tres roles. No se ha probado enviar reportes desde este rediseño ni ejecutar cada operación de escritura existente.
- Movimiento reducido: todas las vistas sin animaciones cuando el sistema lo solicita. Controles principales y enlaces de navegación de al menos 44 px.
- Login: comparación píxel a píxel idéntica a producción a 390 y 1440 px. GUARDIA: captura estable de producción y local idénticas a 390 px; la primera captura histórica se tomó durante la entrada animada de su navegación, por lo que se repitió el control esperando la estabilización. No se modificaron sus componentes, CSS global ni puente nativo.
- Validación de tipos y lint del monorepo, build web y 986 pruebas web correctas. Otras 21 pruebas del formulario de tareas/cola verifican la configuración operativa asociada.

## Resultado

Sin hallazgos P0/P1/P2 pendientes en las pantallas y estados revisados. No se ejecutan los guiones demo que escriben datos sobre empresas productivas: este cambio no altera endpoints ni SQL. La verificación de despliegue debe comprobar salud, vistas reales y continuidad de API/base de datos; no iniciar una ronda de un guardia real para probar el diseño.

## Verificación del despliegue

Panel publicado y comprobado en producción en escritorio/móvil; ADMIN y SUPERVISOR sin errores JavaScript en las capturas. Navegación móvil operativa y sin desbordes. API, PostgreSQL, Redis y cola de sincronización responden correctamente. PostgreSQL y Redis conservaron identificadores y fechas de arranque.

P3 de seguimiento: el catálogo de SUPERADMIN emite una recuperación de hidratación React #418 al mostrar actividad histórica. No se observó bloqueo del catálogo ni del menú. La hipótesis es el formateo localizado de fechas en el componente existente (sin cambios en este trabajo); falta aislarlo para una corrección específica. No afecta a la vista del guardia ni a los flujos de ronda. Las comprobaciones locales de 22 vistas descritas arriba se mantienen sin errores; no se presenta esa comprobación como ausencia de avisos en todos los entornos.
