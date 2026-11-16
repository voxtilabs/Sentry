# ControlGuard: mapa funcional y comparación con SentryCore

Fecha de revisión: **16 de noviembre de 2026**. Fuente: navegación autenticada de la plataforma web de clientes de ControlGuard, con la cuenta autorizada por el propietario. Este documento describe funciones, no contiene datos de operación de clientes.

Se recorrieron **29 vistas del menú**, además de formularios, pestañas y paneles secundarios. No se guardaron cambios, generaron rondas, enviaron mensajes, contrataron servicios ni ejecutaron pagos. No se descargaron exportaciones con información personal. Durante la inspección de formularios se bloquearon las solicitudes HTTP de modificación; las acciones de guardado y su autorización efectiva no están verificadas.

La comparación con SentryCore se apoya en el código del repositorio. La base desplegada al comenzar esta revisión era `283f0f8`; la configuración nueva de correos del trabajo #469 se identifica por separado, porque se estaba implementando durante el relevamiento.

## Cómo leer el inventario

- **Vista confirmada:** se abrió la pantalla y se observaron sus filtros, columnas, controles o ayudas.
- **Formulario confirmado:** se abrió el editor o panel; no se probó el guardado.
- **Opción visible:** existe el botón, enlace o acción, pero no se ejecutó su efecto.
- **No comprobado:** no se dispone de prueba suficiente del comportamiento completo.

Que una opción sea visible no demuestra que su servidor la permita a todos los roles. Solo se utilizó una cuenta; no se verificaron los demás perfiles de ControlGuard ni su aislamiento de datos. Tampoco se probó físicamente su aplicación móvil, lector NFC, cámara o seguimiento en segundo plano.

## 1. Inventario completo del menú observado

Las rutas de esta tabla son enlaces internos de la plataforma `https://clientes.controlguard.cl/`. Se omiten deliberadamente identificadores de cuentas y registros.

| Grupo / vista | Ruta | Funciones, entradas y salidas observadas | Verificación y límites |
|---|---|---|---|
| Home | `#/home` | Contadores de clientes, instalaciones, guardias y supervisores; acceso a sus catálogos; eventos recientes y acceso al historial. | Vista confirmada. No se modificó la página de inicio. |
| Dashboard nuevo | `#/dashboard` | Filtros de mes, cliente e instalación; comparación con el mismo tramo del mes anterior; rondas realizadas, programa cumplido, puntos marcados, duración, distancia y novedades; desglose por cliente/instalación, atención prioritaria, evolución diaria y guardias destacados. Controles de exportación a Excel e imagen y de establecer como inicio. | Vista confirmada; exportación y cambio de inicio solo visibles. La ayuda indica actualización con el día anterior y distingue actividad fuera de línea y rondas muy cortas descartadas. |
| Chat | `#/chat` | Interfaz de mensajería con campo para redactar mensajes. | Vista y compositor confirmados; no se enviaron mensajes ni se copiaron conversaciones. Alcance de participantes y confirmaciones de entrega no comprobados. |
| Seguimiento | `#/seguimiento` | Selección de cliente e instalación y búsqueda de seguimiento. | Vista confirmada; no se verificaron en terreno frecuencia de actualización, historial o precisión del mapa. |
| Reportes → Eventos | `#/eventos` | Rango de fechas, cliente e instalación; tabla de evento, fecha, cliente e instalación; búsqueda y paginación. | Vista confirmada. No se provocaron eventos de prueba. |
| Reportes → Rondas | `#/reportesrondas` | Rango de fechas, cliente, instalación y turno; secciones/columnas de detalles, novedades, sensores y cumplimiento; búsqueda, paginación y Excel. | Vista confirmada. No se descargó Excel ni se reprodujo una ronda móvil. |
| Reportes → Listas de chequeo | `#/reportelistachequeo` | Fechas, cliente, instalación y turno; resultados por instalación, fecha, guardia, turno y tareas. | Vista confirmada. No se enviaron respuestas de prueba. |
| Reportes → Asistencia | `#/asistencia` | Fechas y cliente; tabla con fecha, guardia, instalación, turno, ingreso, salida y tiempo. | Vista confirmada. No se comprobó certificación legal de asistencia ni integración de remuneraciones. |
| Reportes → Libro de novedades | `#/libronovedades` | Fechas, cliente e instalación; criticidad, fecha, observación y fotografías; búsqueda y paginación. | Vista confirmada; no se copiaron observaciones ni imágenes. |
| Supervisor → Movimientos | `#/reportesupervisor` | Fecha, hora inicial/final, supervisor y tipo de movimiento; mostrar instalaciones y filtrar datos; tabla de fecha, instalación y actividad. | Vista confirmada. La búsqueda admite referencias a entrada/salida e instalación; no se verificó generación móvil de esas marcas. |
| Supervisor → Novedades | `#/novedadesupervisor` | Fechas, criterio de búsqueda y supervisor; resultados con criticidad, fecha, supervisor, instalación, turno, observación y fotos. | Vista confirmada. |
| Control de acceso → Registros de usuarios | `#/controlusuarios` | Filtros de cliente/instalación; persona, cédula de identidad, último acceso, estado y acciones. | Vista confirmada. No se alteraron estados de personas. |
| Control de acceso → Registros de vehículos | `#/controlvehiculos` | Cliente/instalación; patente, marca/modelo, color, tipo, último acceso y estado. | Vista confirmada. No se consultaron patentes externas ni se comprobó el origen o vigencia de esos datos. |
| Control de acceso → Registros de accesos | `#/registrosaccesos` | Fechas, cliente e instalación; fecha, tipo, visitante, datos de ingreso, datos de salida y estado. | Vista confirmada. No se registraron ingresos ni salidas ficticias. |
| Control de acceso → Campos Control | `#/camposcontrol` | Configuración por cliente/instalación: instalaciones vinculadas, lista blanca, modo de control y campos configurables; nombre, tipo, bloqueo y eliminación de campos. Manual de la app disponible. | Vista y configuración confirmadas tras seleccionar instalación; no se guardó. Detalle en sección 4. |
| Maestros → Clientes | `#/clientes` | Catálogo con razón social y datos de contacto; búsqueda; alta de cliente. | Vista y formulario de alta confirmados; no se guardó ni eliminó ningún cliente. |
| Maestros → Guardias | `#/guardias` | Catálogo y alta; nombre, dirección, teléfono y nacionalidad. | Vista y formulario confirmados. No se deduce el mecanismo de autenticación móvil solo a partir de estos campos. |
| Maestros → Instalaciones | `#/instalaciones` | Catálogo, guardias, puntos QR/NFC y código; alta, edición, envío de ronda y eliminación como acciones visibles. | Vista, alta y panel NFC confirmados. No se enviaron rondas, modificaron etiquetas ni ejecutaron eliminaciones. |
| Maestros → Agenda rondas | `#/rondas` | Cliente e instalación; nombre, días, turno y hora inicial. Alta individual y creación automática por intervalo/cantidad. | Vista y ambos formularios confirmados; no se guardó ni generó ninguna ronda. |
| Maestros → Rondas Patrón | `#/rondaspatron` | Cliente, instalación, turno, fechas de creación/actualización; mapa y configuración de tolerancias para comparar ejecuciones con la referencia. | Vista, mapa y tolerancias confirmados; no se cambió la referencia. |
| Maestros → Supervisores | `#/supervisores` | Nombre, instalaciones asignadas, código y acciones; alta con selección de instalaciones. | Vista y formulario confirmados; no se crearon supervisores. |
| Maestros → Usuarios | `#/usuarios` | Nombre, email, tipo, clientes y último acceso; alta con nombre, email y categoría. | Vista y formulario confirmados. No se cambió categoría ni permisos; matriz completa de roles no comprobada. |
| Maestros → Listas de chequeo | `#/listaschequeo` | Cliente, instalación, turno, tareas, destinatarios de notificación y acciones; editor de actividades. | Vista y formulario confirmados; no se guardó. Se distingue de las tareas asociadas a una tarjeta NFC. |
| Servicios extra → Botón de pánico | `#/botonpanico` | Configuración por cliente/instalación; propiedades, mensualidad, administrador, cobro y acciones; alta con tramo contratado y contacto administrador. | Vista y formulario confirmados; no se activó el servicio ni se simuló un pánico. La pantalla presenta contratación/prueba y cobro por instalación. |
| Servicios extra → Alertas WhatsApp | `#/alertas-whatsapp` | Selección de tipos de evento, cantidad de destinatarios, simulación de consumo y bolsa mensual; contratación. | Vista y explicaciones confirmadas; servicio no contratado ni mensajes enviados. Detalle en sección 5. |
| Servicios extra → Conector con IA | `#/conector-ia` | Activación del conector, selección comercial por instalaciones/clientes y cobro asociado. | Pantalla comercial confirmada. No se activó ni generó clave. No están comprobados protocolo operativo, herramientas, permisos ni datos expuestos. |
| Facturación | `#/facturas` | Detalle de facturación, pago y documentos tributarios; fecha, folio, tipo, monto, documento y fecha de pago. | Vista confirmada; no se pagó ni descargó documentación tributaria. |
| Configuración → Reportes Automáticos | `#/config-reportes-automaticos` | Pestañas diaria y mensual, destinatarios internos y configuraciones diarias por cliente. | Ambas pestañas y formulario por cliente confirmados. Detalle en sección 6. |
| Configuración → Cambiar contraseña | `#/cambiapassword` | Contraseña antigua, nueva y repetición; cancelar/guardar. | Formulario confirmado; no se cambió ninguna credencial. |

La opción **Salir** también está en la navegación. No constituye un módulo adicional del inventario.

## 2. Maestros, agenda y etiquetas: detalles útiles

### Instalaciones

El alta expone cliente, nombre, dirección capturada por la aplicación de supervisor, bloqueo de dirección, teléfono/correo de alertas opcionales, zona horaria, duración máxima de ronda, código y asignación de guardias.

En cada fila se observaron controles distintos para puntos **QR** y **NFC**, edición de la instalación, envío de una ronda y eliminación. La existencia del código indica un acceso o asociación a instalación; no se verificó el contrato de autenticación ni su rotación.

### Puntos NFC y tareas

El panel NFC presenta tarjetas con nombre, código y tareas de verificación; permite introducir un código hexadecimal, agregar tarjeta, abrir tareas, eliminar una tarjeta y guardar el conjunto. Se confirmó la presencia de varias tareas por tarjeta. Los valores de etiquetas y las instrucciones reales se excluyen de este documento.

El editor de tareas NFC inspeccionado permite describir, agregar y eliminar tareas. No se observaron allí controles explícitos de mínimo/máximo de fotos o tipo de respuesta; eso queda sin comprobar y no debe confundirse con la configuración más detallada que ya tiene SentryCore.

Esto permite separar tres conceptos que no conviene mezclar en una futura migración:

1. Identidad física del punto: etiqueta QR/NFC.
2. Actividades o preguntas vinculadas al punto.
3. Lista de chequeo general de una instalación o turno.

No se reescribieron tarjetas ni se comprobó su efecto sobre el lector nativo de otras aplicaciones.

### Agenda de rondas

El alta individual solicita cliente, instalación, nombre, días, hora inicial y turno. Los botones de creación necesitan una instalación seleccionada.

La creación automática abre un formulario con nombre base, hora inicial, intervalo en minutos, cantidad de rondas, días y turno. Es una generación en lote; no se ejecutó el botón que la confirma. No se comprobó cómo trata cruces de medianoche, solapamientos, duplicados o cambios posteriores de agenda.

### Listas de chequeo

El editor incluye cliente, instalación, actividades y correos de notificación. La ayuda declara que una respuesta negativa genera una notificación a la lista configurada, que puede incluir contactos internos y del mandante. Esa automatización se observó en la ayuda; no se disparó una respuesta negativa real para verificar entrega.

## 3. Ronda patrón y análisis del recorrido

La configuración observada compara la ejecución con una ronda de referencia y expone:

| Parámetro | Propósito expresado en la interfaz | Límite de esta revisión |
|---|---|---|
| Tiempo | Banda aceptada respecto de la duración base. | No se recalculó contra una ejecución. |
| Distancia | Banda aceptada respecto de la distancia de referencia. | No se probó el algoritmo de distancia. |
| Velocidad | Banda aceptada respecto de la velocidad de referencia. | No se comprobó cómo maneja detenciones o GPS errático. |
| Dispersión de escaneos | Separación máxima respecto del punto esperado. | No demuestra por sí misma precisión física del GPS. |
| Puntos omitidos | Cantidad permitida de escaneos faltantes. | No se modificó ni probó su penalización. |
| Waypoints | Cantidad de muestras esperada respecto de la base. | No se verificó muestreo nativo o en segundo plano. |
| Orden | Exigir la secuencia de puntos establecida. | No se provocó un recorrido fuera de orden. |
| Umbral de correo | Aviso cuando la eficiencia queda por debajo del porcentaje configurado. | Campo y ayuda confirmados; no se enviaron correos. |
| Destinatarios | Lista de emails para los reportes del recorrido. | Editor visible; no se guardó. |

El mapa de referencia expone resumen de cliente, instalación, turno, tiempo total, distancia, velocidad promedio y puntos escaneados. Se abrió el panel, pero no se exportaron coordenadas.

**Implicación para SentryCore:** aprovechar una referencia para diagnosticar diferencias es razonable. No conviene copiar automáticamente una sanción por velocidad, dispersión o cantidad de muestras sin distinguir una desviación real de una medición de mala calidad. La existencia de un mapa en ControlGuard tampoco demuestra que su dispositivo mantenga una señal mejor.

## 4. Control de accesos

Las cuatro vistas observadas separan personas, vehículos, movimientos de ingreso/salida y configuración de campos. La configuración por instalación incluye:

- Vinculación de instalaciones.
- Uso de una lista blanca.
- Selección de modo de control.
- Campos configurables, con nombre y tipo.
- Estado de bloqueo de campos.
- Agregar/eliminar campos y guardar el conjunto.
- Acceso a un manual de uso de la aplicación.

Los registros muestran identidad de la persona, estado y último acceso; los vehículos agregan patente y datos descriptivos. Los movimientos conservan datos separados de ingreso y salida.

No se comprobó si la lista blanca produce una prohibición, advertencia o autorización asistida; tampoco su comportamiento sin conexión. El mero hecho de exhibir marca/modelo no permite identificar una API de patentes ni asegurar cobertura, actualización o consulta de encargos por robo.

Una integración futura debe definir qué información necesita realmente el guardia y qué campos se conservan. El mapa funcional no autoriza copiar indiscriminadamente fichas personales ni reutilizar sus datos para otro fin.

## 5. Servicios extra y comunicaciones

### WhatsApp

La pantalla permite estimar y contratar alertas por pánico del guardia, pánico de comunidad, novedades de distintas criticidades e ingreso fuera de nómina. La explicación visible establece:

- El consumo depende de cada evento y cada destinatario; las pulsaciones repetidas no se agrupan.
- Existe una bolsa de mensajes y avisos de consumo.
- Agotar la bolsa detiene el canal WhatsApp, incluso para pánicos; la ayuda distingue la recepción por app/web.
- La activación de un número requiere una acción de su propietario desde WhatsApp.
- Las novedades capturadas sin señal se notifican después de la sincronización, conservando la hora del hecho.

Estas son reglas descritas por la plataforma; no se contrató ni validó el transporte real. No se incluyen precios porque no son necesarios para el inventario y pueden cambiar.

### Pánico, comunidad y supervisor

El servicio extra de pánico expone una configuración comercial y un administrador por instalación. Las menciones a pánico de guardia y comunidad en WhatsApp sugieren dos orígenes de evento, pero no se recorrió la aplicación o portal de comunidad. No se afirma cómo se autentica a residentes ni cómo se despacha una emergencia.

### Conector IA

Se comprobó la oferta y su pantalla de activación, no una integración operativa. Quedan pendientes herramientas disponibles, límites, aislamiento por cliente, acceso de escritura y revocación de claves. La revisión no generó credenciales de integración.

### Chat

Se observó el compositor web. No se comprobó el flujo móvil, adjuntos, recepción en segundo plano, retención, auditoría o mensajería entre empresas. Debe tratarse como un candidato independiente, no como una función ya equivalente a novedades y alertas.

## 6. Reportes automáticos: comportamiento observado de ControlGuard

### Diario interno

Puede activarse un consolidado de todos los clientes de la empresa, dirigido a la administración interna. Tiene lista de emails, hora y formato por defecto **Excel o PDF**.

La ventana declarada es **móvil de 24 horas hasta la hora elegida** y toma rondas finalizadas. No equivale necesariamente al día calendario anterior. El procesamiento se describe por intervalos de 15 minutos.

### Diario para cada cliente

Existe una lista de configuraciones independientes por cliente. Cada configuración solicita:

| Campo | Comportamiento mostrado |
|---|---|
| Cliente | Obligatorio. |
| Instalaciones | Selección específica; vacía significa todas las del cliente. |
| Emails | Lista propia y obligatoria. |
| Hora | Opcional; al quedar vacía hereda la hora de la empresa. |
| Formato | Puede heredar el formato de la empresa o elegir uno propio. |
| Novedades | Interruptor para incluirlas. |
| Habilitado | Activación de la configuración. |

### Mensual interno

Es un envío independiente del diario y se activa por separado, pero **comparte la misma lista de administración**. Editar esos emails desde cualquiera de las pestañas afecta ambos envíos.

La ayuda observada establece:

- Mes anterior completo.
- Envío a partir del **día 3**, dando margen a rondas sincronizadas fuera de línea.
- **Excel único**, sin selección de hora ni formato.
- Carácter exclusivamente interno; no permite configurar su envío a un mandante.

La estructura anunciada del libro es:

| Hoja | Contenido descrito |
|---|---|
| Portada | Resumen e indicadores del mes. |
| Detalle | Una fila por día e instalación. |
| Clientes | Agregado por cliente. |
| Instalaciones | Agregado por instalación. |
| Tendencia | Evolución diaria del período. |
| Excepciones | Eventos críticos y desviaciones recurrentes. |
| Metodología | Definición de los indicadores. |

El motivo declarado para mantenerlo interno es que mezcla clientes e indicadores de gestión del personal. **No se descargó un libro real:** el diseño anterior está confirmado por la ayuda y no por inspección de sus celdas.

### Qué no se encontró

En el menú y ambas pestañas inspeccionadas **no se observó una frecuencia semanal**, ni un mensual externo por cliente. Esto describe el acceso revisado, no demuestra que dichas funciones no existan en otros planes o versiones.

Las limitaciones anteriores **no son requisitos para SentryCore**. El propietario pidió semanal y mensual por destinatarios propios, incluido cliente final.

## 7. Comparación con SentryCore

“Existe” significa que se identificó implementación en el repositorio, no que en esta tarea se haya vuelto a probar cada flujo de extremo a extremo.

| Capacidad de ControlGuard | Estado en SentryCore al revisar | Evidencia local / diferencia principal |
|---|---|---|
| Empresas, instalaciones y usuarios | Existe, con otro modelo | `platform`, `admin`, `roles.ts`: empresa/tenant separado de recinto. Mantener el aislamiento de las empresas existentes; no convertirlas automáticamente en un cliente compartido. |
| Asignación de supervisores y guardias | Existe | `supervisor_sites`, `guard_sites`, módulos `admin` y `operations`; el servidor limita cada supervisor a sus recintos. |
| Puntos QR/NFC | Existe | `admin/puntos-supervisor.controller.ts`, módulo `qr` y puente nativo móvil. |
| Tareas por punto, preguntas y fotos | Existe | `checklists/tareas-turno.controller.ts` y componentes `guard-tareas-*`; requisitos configurables. |
| Lista de chequeo general | Existe | `checklists/checklists.controller.ts`; distinguir plantilla de turno y tarea por punto. |
| Agenda y generación de rondas | Existe | Módulos `supervisor` y `scheduling`: turnos, asignaciones, patrones y recurrencias. Revisar experiencia de generación en lote antes de declarar equivalencia con su editor. |
| Ronda patrón | Existe / comparación parcial | Módulo `reference`, reglas GPS y trazas; no asumir que todas las tolerancias de ControlGuard tienen una correspondencia exacta. |
| Monitoreo en vivo | Existe | `supervisor/live`, `events-stream`, panel de monitoreo y mapas. |
| Novedades y pánico | Existe | `guard/events`, módulo `escalation`, evidencias, panel y notificaciones. No equivale al producto de pánico de comunidad. |
| Informes de ronda y fotos | Existe | Módulo `reports`: PDF con recorrido/evidencia y acceso autorizado. |
| Resumen por período | Existe bajo demanda | `reports/reports.service.ts`: resumen por recinto, semanas/rutas y fotos opcionales; no es el mismo libro mensual multicliente de ControlGuard. |
| Excel | Existe | `reports/excel-export.*`: hojas de rondas, escaneos y novedades, con alcance de autorización y sin coordenadas del trabajador. |
| Gráficas de cumplimiento | Existe / alcance distinto | `stats/stats-charts.*`: evolución, recintos, rutas, omisiones y ranking. Su portada mensual comparativa puede inspirar mejoras puntuales. |
| Asistencia | Parcial | Marcajes de jornada en `guard.service.ts` y turnos. El código los define como operativos; no declarar equivalencia con un registro legal de asistencia. |
| Movimientos específicos de supervisor | Parcial / candidato | Existe ronda patrón y operación de supervisor; no se identificó en esta revisión una pantalla idéntica de entradas/salidas de visitas de supervisión. |
| Visitas, vehículos e ingreso/salida | Existe | Módulo `visits` y registro de visitas; verificar por separado cualquier nueva consulta externa de datos vehiculares. |
| Campos arbitrarios de accesos | Candidato | No se identificó un constructor equivalente al editor de campos observados de ControlGuard. |
| Lista blanca e instalaciones vinculadas | Candidato / por definir | El flujo de visitas existente no demuestra por sí solo un control de autorización equivalente. Definir política y comportamiento sin señal antes de implementarlo. |
| Chat operativo | Candidato | No se identificó un módulo de chat funcional en el repositorio; novedades no sustituyen una conversación. |
| WhatsApp por eventos | Candidato | Existen escalamiento, correo y push; no se identificó transporte WhatsApp operativo en los módulos revisados. |
| Pánico de comunidad / residentes | Candidato | No se identificó una aplicación de residentes equivalente. |
| Conector IA para clientes | Candidato | No se identificó una API de herramientas para un asistente externo equivalente al conector comercial observado. |
| Facturación y pago | Parcial | Existen licencias/operación de plataforma; no se comprobó un portal equivalente de documentos tributarios y pago de la empresa cliente. |
| Alertas bajo umbral y listas por recinto | Existe; ampliación #469 en curso durante la revisión | `envio-informe.service.ts`, reglas y `operations`: selección de destinatarios. El trabajo #469 agrega modo de un único aviso bajo umbral. |
| Correos diarios/semanales/mensuales | Nuevo trabajo #469 | Configuración por recinto, lista común o por frecuencia y resúmenes agregados. No copiar la restricción de mensual solo interno de ControlGuard. |

### Diferencias deliberadas de los correos de SentryCore (#469)

La implementación en curso durante esta revisión permite diario, semanal y mensual con destinatarios propios o lista común; incluye destinatarios externos del cliente si el supervisor los configura. Los períodos se calculan con la zona horaria del recinto y el resumen agrupa indicadores sin adjuntar el conjunto de fotos ni fichas del personal.

El diario de SentryCore se diseña como día calendario anterior, la semana como lunes a domingo y el mensual como mes anterior. ControlGuard describe, en cambio, una ventana diaria móvil y un mensual interno diferido al día 3. Conviene mostrar estas definiciones en la interfaz y en el resumen para evitar comparaciones con ventanas distintas.

No se debe interpretar “compartir lista” como autorizar envíos cruzados entre empresas. En SentryCore una lista común pertenece a su ámbito autorizado; el informe de un cliente final debe contener únicamente su información.

## 8. Candidatos de integración y prioridad sugerida

| Prioridad | Propuesta para evaluar | Qué reutilizar | Qué falta decidir/probar |
|---|---|---|---|
| Alta | Resumen ejecutivo con metodología y excepciones | Estadísticas, reportes y correos de SentryCore | Indicadores claros, ventanas locales y manejo de sincronizaciones tardías; separar reporte interno de externo. |
| Alta | Comparación GPS contra patrón con calidad de muestra visible | `reference`, trazas y reglas | Distinguir mala señal, falta de muestras y desvío real; evitar penalizar automáticamente por GPS deficiente. |
| Alta | Mejorar generación de agenda desde un formulario simple | Patrones y recurrencias existentes | Vista previa, cruces de medianoche, colisiones e idempotencia; no crear una segunda agenda paralela. |
| Media | Seguimiento de visitas de supervisión | Identidad de supervisor, recintos, novedades y trazas | Evento de visita, ingreso/salida, propósito y reporte; consentimiento y alcance operativo. |
| Media | Campos opcionales configurables de visitas | Formularios y módulo `visits` | Tipos admitidos, obligatoriedad, bloqueo, minimización, retención y compatibilidad offline. |
| Media | Lista de autorizados con alertas de excepción | Registro de visitas y escalamiento | Advertencia frente a bloqueo, responsables de autorizar, vigencia y sincronización entre recintos. |
| Media | WhatsApp opcional para eventos críticos | Escalamiento existente | Proveedor y costos reales, activación de destinatarios, deduplicación y canal alternativo cuando falle o se agote cuota. |
| Baja / producto separado | Chat, comunidad/pánico de residentes, conector IA | Identidad, permisos y auditoría | Necesidad real, mantenimiento, alcance de datos, costos y riesgos antes de ampliar superficie. |

Estas prioridades son propuestas de análisis; no constituyen nuevas funcionalidades aprobadas ni implementadas por este documento.

## 9. Límites y próximas comprobaciones

1. No se cambió configuración de ControlGuard ni se verificó ejecución de guardados, eliminaciones, correos o cobros.
2. No se instalaron sus aplicaciones móviles ni se probaron NFC, cámara, ubicación continua, consumo o trabajo fuera de línea en un dispositivo.
3. No se inspeccionaron exportaciones reales con datos personales. Formatos y hojas se describen según botones y ayuda de la interfaz.
4. No se verificó una API pública o contrato de integración. Las peticiones que utiliza su propia web no demuestran que exista una API pública soportada para terceros.
5. No se verificaron roles distintos, planes no contratados, un usuario mandante ni un portal de residentes.
6. No se probaron servicios extra que requieran activación o contratación.
7. No se copiaron identidades de etiquetas, códigos de acceso, nombres de personas, direcciones, observaciones, fotografías o rutas específicas en este archivo.
8. Una integración futura necesita una matriz de campos y permisos y una prueba pequeña autorizada; no una extracción indiscriminada de la base de operación.

## 10. Referencias de verificación

- Plataforma revisada: [ControlGuard clientes](https://clientes.controlguard.cl/#/login). Las rutas funcionales están en el inventario de la sección 1 y requieren acceso autorizado.
- Contexto de SentryCore: [CLAUDE.md](../CLAUDE.md).
- Navegación actual del panel: [panel-navigation.ts](../apps/web/app/_components/panel-navigation.ts).
- Roles y permisos: [roles.ts](../packages/shared/src/roles.ts).
- Reglas configurables: [rules.ts](../packages/shared/src/rules.ts).
- Informes y resumen bajo demanda: [reports.service.ts](../apps/api/src/reports/reports.service.ts).
- Exportación Excel: [excel-export.service.ts](../apps/api/src/reports/excel-export.service.ts).
- Programación: [scheduling.service.ts](../apps/api/src/scheduling/scheduling.service.ts).
- Ronda patrón: [reference.controller.ts](../apps/api/src/reference/reference.controller.ts).
- Visitas y vehículos: [visits.controller.ts](../apps/api/src/visits/visits.controller.ts).
- Correos por recinto: [operations.service.ts](../apps/api/src/operations/operations.service.ts).

Este inventario debe actualizarse al comprobar una función pendiente o cambiar el producto; las funciones comerciales y de otros planes pueden variar después de la fecha de revisión.
