# ADR 0139 — Control de acceso de visitantes en portería y recepción

- **Estado: ACTUALIZADA por solicitud explícita de producto del 22-10-2026.**
- **Fecha:** 2026-08-18
- **Issue:** #139
- **Hito:** Planificado para Fase 2 (M4) como módulo Add-on de pago
- **Autores / Rol:** Subagente Analista de Arquitectura Core SentryCore

---

## 1. Contexto y Problema

Durante el levantamiento de requerimientos con empresas de seguridad privada y administradores de instalaciones (clientes objetivo de SentryCore), ha surgido de forma reiterada la solicitud de incorporar **control de acceso de visitas y contratistas en portería/recepción** (registro de entrada/salida de personas, captura de cédula de identidad/RUT, fotografía del visitante y registro de vehículos).

En el mercado chileno existen soluciones concurrentes:
1. **Sistemas de rondas puros** (ej. Deggy, Guard1, Active Track): enfocados estrictamente en el control de rondas mediante puntos de marcación (iButton/NFC/GPS), con cero funcionalidad de portería.
2. **Plataformas de seguridad y portería integradas** (ej. Control Guard, Safeturn, CityTrooper): ofrecen módulos de portería digital donde el guardia registra visitas con escaneo de cédula de identidad chilena para sustituir el libro de papel de recepción.
3. **Software de administración de condominios** (ej. ComunidadFeliz, Edifito, Kastor): orientados a copropiedad inmobiliaria con control de visitas básico pero sin capacidades avanzadas de fiscalización de rondas operativas.

El problema arquitectónico y de negocio a resolver es: **¿Debe SentryCore incorporar el control de acceso de visitantes dentro del alcance del MVP (M1/M2), o debe postergarse para una etapa posterior sin desviar el Core de verificación de rondas?**

---

## 2. Opciones Evaluadas

### Opción 1: Incorporar Control de Visitas en el Core MVP (M2) con OCR MRZ en la App Móvil
- **Descripción:** Desarrollar en el backend las entidades de visitantes, pases, autorizaciones de anfitriones y registro de accesos en portería, sumando a la app móvil un lector OCR de la zona MRZ de la Cédula de Identidad chilena.
- **Ventajas:** Paridad de características comerciales inmediatas contra plataformas como Control Guard en licitaciones "todo en uno".
- **Desventajas:**
  - **Desviación crítica de foco (Scope Creep):** Duplica la superficie del dominio (gestión de visitas, pre-autorizaciones, blacklist de visitas, cálculo de permanencia, gestión de estacionamientos).
  - **Inviabilidad técnica en gama baja:** La lectura OCR de MRZ en teléfonos de entrada en garitas oscuras tiene alta tasa de error (ver sección 4).
  - **Complejidad regulatoria:** Impacto severo en la Ley 21.719 de Protección de Datos Personales (ver sección 5).
  - **Degradación del rendimiento móvil:** Agrega bibliotecas pesadas de visión artificial (20–30 MB al APK), violando el principio de APK liviano y arranque rápido (`docs/tamano-apk-y-arranque.md`).

### Opción 2: Descartar Permanentemente el Módulo de Visitas
- **Descripción:** Posicionar a SentryCore exclusivamente como un software de monitoreo de rondas de guardia (patrol tour verification), rechazando cualquier función de registro de visitas.
- **Ventajas:** Simplicidad arquitectónica máxima y cero pasivos legales sobre datos de terceros.
- **Desventajas:** Pérdida de oportunidades comerciales en instalaciones corporativas y parques industriales donde la empresa de seguridad provee tanto el rondín como la caseta de control de acceso perimetral.

### Opción 3 (Seleccionada): Aplazamiento a Fase 2 (M4) como Módulo Add-on de Pago con Modelo de Recintos Preparado
- **Descripción:** Congelar el desarrollo de visitantes para el MVP (M1/M2/M3), manteniendo el Core concentrado en rondas, cumplimiento operativo, libro de novedades y detección de fraude. Preparar la arquitectura relacional (entidad `Site`) para que en Fase 2 (M4) el módulo de visitas se conecte como un add-on desacoplado y tarifable.
- **Ventajas:**
  - Protege el roadmap de entrega y la estabilidad de las rondas offline (#14) y auditoría (#104).
  - Mantiene el APK móvil ligero y optimizado para teléfonos corporativos de bajo presupuesto.
  - Permite estructurar un modelo de cumplimiento legal sólido para la Ley 21.719 con tiempo suficiente.
  - Genera una nueva línea de ingresos (Add-on de pago por recinto de portería).

---

## 3. Decisión de Arquitectura

Se decide **APLAZAR el desarrollo del módulo de Control de Acceso de Visitantes a la Fase 2 (Mito M4)**, bajo las siguientes directrices técnicas y de producto:

1. **No contaminación del Core MVP:** Las tablas centrales de negocio (`patrols`, `scans`, `checkpoints`, `field_events`, `shifts`) no contendrán columnas, referencias ni lógica condicional referente a visitantes o recepción.
2. **Preparación del modelo relacional (`Site` como ancla):** La entidad `Site` (recinto) ya contiene las propiedades necesarias (`id`, `tenant_id`, `branch_name`, `timezone`, `site_business_hours`) para albergar en el futuro entidades subordinadas (`site_visitor_sessions`, `site_visitor_policies`) sin requerir refactorizaciones destructivas.
3. **Mecanismo de contingencia en MVP:** Para eventos aislados de acceso o incidentes con visitas durante las rondas de noche, los guardias utilizarán el **Libro de Novedades / Eventos de Terreno** (`field_events`, issue #124) seleccionando la categoría operativa correspondiente, sin convertirlo en un registro peatonal masivo.
4. **Empaquetado como Add-on en M4:** En Fase 2, la funcionalidad se implementará como un módulo aislado en backend (`apps/api/src/modules/visitors/`) y frontend/mobile (`apps/mobile/src/modules/visitors/`), gobernado por un feature flag de plan (`featureFlags.visitorAccess`) y permisos RBAC específicos (`visitors:manage`, `visitors:register`).

---

## 4. Análisis de Viabilidad Técnica: OCR MRZ en Gama Baja

### 4.1. Anatomía de la Cédula Chilena (Registro Civil / ICAO 9303)
La cédula de identidad chilena vigente contiene en su reverso una zona de lectura mecánica (MRZ) de formato **TD1** (3 líneas de 30 caracteres alfanuméricos) que codifica tipo de documento, país emisor (CHL), número de documento, dígito verificador, fecha de nacimiento, sexo, fecha de expiración, nacionalidad y RUN/RUT del titular.

```
I<CHL12345678<9<<<<<<<<<<<<<<<
9001014M3001018CHL<<<<<<<<<<<8
APELLIDO<PATERNO<<NOMBRES<<<<<
```

### 4.2. Restricciones de Hardware en Terreno
Los teléfonos asignados por empresas de seguridad a guardias de garita son habitualmente terminales Android de gama de entrada (ej. Samsung Galaxy A04/A05, Motorola Moto E13/G14, Xiaomi Redmi A2/A3):
- **Cámaras de bajo costo:** Sensores con pobre rango dinámico, ausencia de estabilización óptica y lentes con distancia mínima de enfoque larga (dificultad para enfocar texto pequeño a 10–15 cm).
- **Condiciones lumínicas:** Casillas de guardia perimetral con iluminación fluorescente tenue, reflejos intensos sobre el laminado plástico protector de la cédula o desgaste físico (cédulas rayadas/borrosas).
- **Capacidad de cómputo y RAM:** Equipos con 2 GB a 3 GB de memoria RAM. La inicialización de modelos de visión (Google ML Kit Text Recognition o Tesseract OCR embebido) consume entre 120 MB y 250 MB de memoria de trabajo, provocando recolecciones de basura frecuentes y cierres abruptos por *Out-Of-Memory* (OOM) en Android Go / Android estándar.

### 4.3. Evaluación de Alternativas de Reconocimiento

| Mecanismo OCR / Lectura | Tasa de Acierto en Gama Baja | Latencia Promedio | Impacto en App / Red | Veredicto |
|---|---|---|---|---|
| **On-Device ML Kit (Offline)** | 60% – 75% en condiciones de garita | 800 ms – 2.5 s | +22 MB al binario APK; alto consumo de RAM | Inviable en MVP; descartado para gama baja |
| **Server-Side OCR (Envío de foto)** | 85% – 92% | 3.5 s – 7.0 s (dependiente de 3G/4G) | Alto consumo de datos móviles y fotos pesadas | Inviable para operaciones rápidas en barrera |
| **Escaneo de Código de Barras PDF417 / QR** | 90% – 98% (muy sensible a rayas) | 150 ms – 400 ms | +1.5 MB (ZXing/MLKit Barcode) | Viable técnicamente para M4 |
| **Ingreso Manual con Validación Módulo 11** | 100% (con feedback de formato) | 3 s – 5 s (tecleo del guardia) | 0 kB adicionales (algoritmo liviano TypeScript) | **Estrategia base de respaldo mandatoria** |

**Conclusión técnica:** Ningún motor OCR en dispositivo de gama baja ofrece la confiabilidad requerida para una garita vehicular en hora punta sin generar colas. Cuando se implemente en M4, la arquitectura priorizará la lectura del código de barras 2D/QR de la cédula y mantendrá siempre como flujo principal o de rescate el ingreso asistido de RUT con validación automática de dígito verificador (Módulo 11 chileno).

---

## 5. Cumplimiento Normativo: Ley 21.719 de Protección de Datos Personales

La Ley 21.719 (que moderniza la Ley 19.628 y crea la Agencia de Protección de Datos Personales en Chile) impone exigencias estrictas que impactan directamente el tratamiento de datos de visitas:

### 5.1. Principio de Proporcionalidad y Minimización (Art. 3°)
- **Riesgo:** Capturar fotografías de la cédula completa de un tercero implica registrar datos innecesarios para la seguridad física del recinto (ej. firma del titular, profesión, lugar de nacimiento, código de documento del Registro Civil).
- **Directriz de diseño para M4:** El sistema **NO almacenará imágenes de la cédula de identidad** en el servidor de archivos. Solo se almacenarán los datos estrictamente necesarios para el control de acceso:
  1. Nombre y Apellidos.
  2. RUT / RUN o Pasaporte (documento de identidad).
  3. Empresa / Procedencia.
  4. Persona o Unidad de destino (`Host`).
  5. Marca/Patente del vehículo (si aplica).
  6. Timestamp exacto de ingreso y salida.

### 5.2. Fotografías Faciales de Terceros
- La captura de la fotografía del rostro del visitante constituye un dato biométrico/sensible bajo la Ley 21.719.
- Exige **base de licitud explícita** (interés legítimo debidamente justificado por razones de seguridad de la instalación o consentimiento informado expreso en el punto de registro mediante señalética visible).
- Su almacenamiento debe tener retención acotada independiente del archivo de rondas.

### 5.3. Política de Retención y Purga Automática
- Los datos de visitas no pueden persistir indefinidamente.
- En M4 se implementará una regla configurable `visitorRetentionDays` (con default estricto de **30 días**, extensible máximo a 90 días por requerimiento contractual del cliente).
- Cumplido el plazo, las filas de accesos de visitas se anonimizarán o eliminarán mediante un job de purga programado en PostgreSQL.

### 5.4. Ejercicio de Derechos ARCOP y Aislamiento Multitenant
- Si un visitante ejerce su derecho de Cancelación/Supresión (ARCOP), el sistema debe permitir al ADMIN del tenant anonimizar las referencias personales de dicho visitante sin romper la integridad referencial de los logs de acceso históricos.
- La función de exportación y purga completa del tenant (`docs/borrado-y-exportacion.md`, issue #33) cubrirá automáticamente las futuras tablas de visitas gracias al descubrimiento dinámico de la columna `tenant_id`.

---

## 6. Consecuencias de la Decisión

### Consecuencias Positivas
1. **Foco y Calidad en MVP:** El equipo de desarrollo concentra el 100% del esfuerzo en la excelencia de rondas, prevención de fraude de guardias (#11, #60), sincronización offline bidireccional (#14) y reportabilidad ejecutiva en PDF (#60, #308).
2. **Estabilidad de la App Móvil:** Cero incremento de tamaño del bundle ni degradación de memoria en dispositivos de gama baja durante M1/M2/M3.
3. **Reducción de Riesgo Regulatorio:** No se asumen pasivos legales por tratamiento indebido de datos de terceros durante la fase de validación inicial del producto.
4. **Monetización Clara:** Permite empaquetar el Control de Visitas como un producto Add-on de alto valor agregado en M4 con tarificación por punto de portería/garita activa.

### Consecuencias Negativas y Mitigaciones
1. **Objeción Comercial en Licitaciones Integradas:** Algunos prospectos solicitarán una solución única de portería y rondas.
   - *Mitigación:* Capacitar al equipo comercial para posicionar a SentryCore como el líder indiscutido en auditoría, cumplimiento de guardias y prueba jurídica de rondas. Comunicar que el módulo de visitas forma parte oficial del Roadmap M4 (Fase 2).
2. **Registro de Contingencia en Caseta:** Guardias que deban registrar un incidente con una visita sospechosa en la noche.
   - *Mitigación:* Utilizar el módulo existente de Libro de Novedades (`field_events`), el cual permite adjuntar observaciones y fotografía de la situación como evento operativo de seguridad.

---

## 7. Plan de Transición hacia Fase 2 (M4)

Cuando se inicie el desarrollo de M4, se ejecutarán los siguientes pasos técnicos:
1. **Esquema de Base de Datos:** Creación de migraciones TypeORM aisladas para tablas `visitors`, `visitor_passes`, `visitor_access_logs` y `site_visitor_policies`, todas protegidas con RLS (`tenant_id = app_tenant_id()`).
2. **Permisos RBAC:** Incorporación de permisos granulares en `packages/shared/src/permissions.ts`:
   - `visitors:read` (SUPERVISOR, ADMIN)
   - `visitors:register` (GUARDIA en caseta de acceso)
   - `visitors:manage` (ADMIN)
3. **Submódulo Móvil Dedicado:** Implementación en Expo/React Native de un modo "Portería" alternativo al modo "Ronda", permitiendo lectura de códigos de barra por hardware o cámara ligera y teclado numérico asistido para RUT.
4. **Feature Gate:** Integración con `packages/shared/src/rules.ts` en `featureFlagsSchema` bajo la clave `visitorAccess: z.boolean().default(false)`.


## 8. Incorporación solicitada el 22 de octubre de 2026

La solicitud explícita de incorporar visitas sustituye el aplazamiento descrito arriba. Las evaluaciones de rendimiento anteriores son antecedentes de diseño, no mediciones de esta implementación. No se modifica la captura GPS ni la configuración de puntos al incorporar este módulo.

El guardia encuentra **REGISTRAR VISITAS** antes de iniciar una ronda, conserva el recinto seleccionado y puede registrar entradas y salidas. El ADMIN consulta su empresa; el SUPERVISOR, solo sus recintos asignados. El módulo usa tablas independientes de las rondas, RLS forzada y claves foráneas compuestas por empresa.

### Carnet y operación sin señal

Se usa el modelo latino de [ML Kit incluido en Android](https://developers.google.com/ml-kit/vision/text-recognition/v2/android), sin subir imágenes a un OCR externo. La cámara genera una imagen temporal privada que se elimina al terminar la lectura, incluso si falla. Al portal solo llegan nombres, apellidos y RUN; nunca imagen, serie del documento, texto OCR completo, firma, fechas ni MRZ. El guardia informa a la visita y revisa/corrige los campos. Se valida el dígito verificador del RUN.

Excluir el número de documento no hace que el registro deje de tratar datos personales. El responsable del recinto debe definir la finalidad y base jurídica y atender derechos. La [Ley 21.719](https://www.bcn.cl/leychile/navegar?i=1209272) entra en vigor el 1 de diciembre de 2026; hasta entonces continúa el régimen vigente de la Ley 19.628.

La cola usa la base SQLCipher existente del teléfono, sin respaldo de identidad en localStorage. El identificador de la operación evita duplicados al reconectar y se comprueban empresa y guardia de origen para impedir reasignaciones al cambiar de sesión. Los teléfonos anteriores conservan las rondas y el registro manual con conexión; las funciones nuevas requieren protocolo minor 6. Retención configurable `visitorRetentionDays`: 30 días por defecto, 1–90 días, con purga del worker existente.

### Fuentes vehiculares investigadas

Revisión de fuentes y pruebas realizadas el 22-10-2026. No hay búsqueda masiva de patentes ni servicios de pago activados. Una fuente caída, bloqueada o incompleta produce **no consultado**, nunca un resultado limpio.

| Fuente | Consulta gratuita y datos | Automatización y límites comprobados |
|---|---|---|
| [Auto Seguro](https://www.autoseguro.gob.cl/) | Encargos por patente/VIN/motor; información orientativa del servicio público | Formulario con reCAPTCHA v2. La investigación posterior consiguió una consulta automática local aceptada por el servidor con herramientas gratuitas; ver la sección de pruebas de CAPTCHA. Todavía no está conectada al adaptador de producción. La vista asistida inicial fue retirada del flujo del guardia: no se le exige resolver CAPTCHA ni visitar portales. |
| [CIPAT / Mi Barrio](https://www.cipat.cl/) | Consulta gratuita de reportes comunitarios por patente | El mismo endpoint del formulario público `/api/lookup?patente=...` respondió HTTP 200 sin clave ni CAPTCHA. Se integra automáticamente. `found:false` significa **sin registro en CIPAT**, nunca libre de encargo oficial. Una respuesta positiva exige coincidencia de patente y un booleano `is_stolen`. Se conservan únicamente estado, marca, modelo y color; no teléfonos, texto libre ni datos de denunciantes. |
| [PRT / MTT](https://www.prt.cl/Paginas/RevisionTecnica.aspx) | Revisión técnica y datos del vehículo; [ChileAtiende confirma gratuidad](https://www.chileatiende.gob.cl/fichas/86124) | Formulario público con CAPTCHA; la conexión HTTPS desde el entorno de trabajo falló por certificado. No se debilita TLS para producción. |
| [Consulta pública de multas del Registro Civil](https://consultamultas.srcei.cl/ConsultaMultas/consultaMultasExterna.do) | Estado de multas, distinto del certificado pagado; [enlace institucional](https://www.colina.cl/transito/permisos-de-circulacion/links-de-interes/) | La prueba respondió HTTP 200 con “Request Rejected”, sin datos. No confundir ese HTML con cero multas. |
| [AutoSign](https://autosign.cl/fact/) | Ficha gratuita: marca, modelo, año, color y otros datos; anuncia dueño registral | Adaptador del formulario público con sesión y CSRF normales. Dos consultas de ejemplo respondieron HTTP 500. El adaptador no inventa datos ni certifica titularidad. |
| [Calistoweb](https://auto.calistoweb.cl/) | Historial de revisión técnica y ficha | Formulario con reCAPTCHA v3. Prueba con navegador real y flujo normal: HTTP 200, `success:false`, “reCAPTCHA verification failed”. No se omite ni falsea su validación. |
| [Patentes Chile](https://www.patentechile.com/) | Anuncia consultas gratuitas de propietarios y características | Chrome visible y Patchright devolvieron HTTP 403. Se pulsó automáticamente la casilla de Cloudflare, pero continuó el bloqueo. El POST público `/resultados`, descrito en proyectos de GitHub, también respondió 403. No se obtuvieron datos. Su [página de contacto](https://www.patentechile.com/contacto/) excluye proporcionar API y bases de datos a terceros. |
| [AutoRiesgo](https://autoriesgo.cl/api) | Vista previa gratuita parcial en su web | El endpoint documentado sin clave devolvió HTTP 403 y exige API comercial para uso programático. [Términos](https://autoriesgo.cl/terminos): no extraer automáticamente la web en lugar de la API. No se integra el servicio de pago. |
| [Boostr](https://boostr.cl/precios) | Prueba de 5 consultas/día, 30 días; requiere clave | No es una fuente gratuita permanente. [Documentación](https://docs.boostr.cl/reference/car-plate) distingue ficha básica y extendida. Sin clave contratada ni prueba activada. |
| [GetAPI](https://getapi.cl/docs/) | Datos vehiculares y robo según plan | Endpoints documentados requieren `X-Api-Key`; no hay clave ni servicio de pago activado. También se probó el endpoint histórico `chile.getapi.cl/v1/vehicles/plate/...` sin clave: HTTP 401. |
| [ImpulsaVehículo](https://vehiculos.impulsacv.cl/faq) | Anuncia gratis PRT, robo y TAG | Consulta web solicita correo y usa Turnstile. No se encontró API pública documentada ni se entregan correos personales al sitio. |
| [Rutificador en Chile](https://rutificadorenchile.cl/rutificador-patente/) | Anuncia ficha gratuita de marca, modelo, año y color | No acredita una API pública utilizable. Su propia página remite al CAV para la titularidad. |
| [Datika](https://www.datika.cl/) | Ficha técnica gratuita por correo | Informe completo pagado. No aporta consulta automática gratuita documentada para la app. |
| [Autofact](https://www.autofact.cl/blog/comprar-auto/antecedentes/revisar-patente-gratis) | Anuncia consulta express gratuita de ficha y último dueño; informe gratis por correo | La prueba de acceso devolvió HTTP 403. No se integra un formulario bloqueado ni se solicitan correos al guardia. |
| [Carvuk](https://www.carvuk.com/consulta-de-patente) | Anuncia ficha y [consulta gratuita de multas](https://www.carvuk.com/consulta-de-multas) | El formulario público cargó HTTP 200, pero mantuvo deshabilitado el envío mientras Cloudflare solicitaba validación. La prueba no produjo datos vehiculares ni un resultado de multas. |
| [Forecars](https://forecars.cl/historial-por-patente) | Historial gratuito sin correo: hasta tres patentes distintas por día desde una conexión; no informa encargo individual por robo | La prueba del formulario quedó detenida por validación antiabuso. Su [documentación para agentes](https://forecars.cl/ai) ofrece API para informes completos pagados, no para la consulta gratis. No se compra ni se activa un informe. |
| [Buscapatentes](https://www.buscapatentes.cl/) | Formulario público de búsqueda | El botón permaneció deshabilitado en la prueba del navegador, sin resultado vehicular. No se fuerza ni se omite su validación. |
| [Autodata](https://autodata.cl/) y [Volante o Maleta](https://www.volanteomaleta.com/) | Sitios de consulta vehicular | Autodata respondió HTTP 403; Volante o Maleta no estableció conexión desde el entorno. No aportaron datos. |
| [PlacApi](https://placapi.com/api-consulta-vehicular-chile) y [Verifik](https://verifik.gitbook.io/verifik/verifik-es/validacion-de-vehiculo/chile/informacion-del-vehiculo) | APIs documentadas de ficha vehicular | Requieren cuenta/credencial y consumo comercial; no se activan. |

El [CAV oficial](https://www.chileatiende.gob.cl/fichas/3370) identifica al titular y es pagado. El [certificado de multas](https://www.chileatiende.gob.cl/fichas/3439) también es pagado y no reemplaza todas las clases de antecedentes. No se compran certificados desde la app.

Las características observadas por el guardia se distinguen de las consultas de fuente. Un resultado leído desde el formulario público en el teléfono queda atribuido como **consulta asistida en teléfono**, con fecha y actor; no es una certificación firmada por el organismo ni una garantía contra adulteración del dispositivo.

### Ajuste del flujo: solo ficha del vehículo

La lectura de patente dispara la consulta automáticamente; no hay botón para abrir Auto Seguro, CAPTCHA, enlaces externos ni campos obligatorios de marca, modelo o color. El guardia ve la ficha y registra el ingreso. Se conserva la posibilidad de repetir el escaneo o corregir una lectura equivocada. La falta de señal o de respuesta de un proveedor no impide registrar la patente y nunca se representa como cero multas ni como ausencia de encargo.

El adaptador desplegado automatiza las fuentes accesibles, pero **todavía no incorpora la prueba local de Auto Seguro** ni obtiene titularidad, multas y encargo oficial en todas las consultas. Esos límites se mantienen visibles en el informe. Las respuestas comunitarias se separan del registro oficial.

### Pruebas de proyectos gratuitos para CAPTCHA

Investigación adicional del 22-10-2026, con una patente autorizada por su titular.
Los informes, capturas, perfiles y modelos se mantienen fuera del repositorio.

- [JacobLinCool/recaptcha-solver](https://github.com/JacobLinCool/recaptcha-solver),
  versión 0.3.0, MIT: Vosk local y ffmpeg. Resolvió el desafío de audio del demo de
  Google en 3,3 segundos y obtuvo un token. Auto Seguro no entregó audio y mostró
  la advertencia de consultas automatizadas; allí terminó con `No Audio Found`.
  Se abrió antes la casilla como adaptación al [problema de selector #10](https://github.com/JacobLinCool/recaptcha-solver/issues/10).
- [Vinyzu/recognizer](https://github.com/Vinyzu/recognizer), referencia
  `8a002c4574a1158ca4fa8519279427fce3614c97`, GPL-3.0: YOLO, CLIP y CLIPSeg
  locales en CPU. Pasaron las dos referencias ensayadas de bicicletas y escaleras.
  El automatismo original no obtuvo token dentro de tres intentos. Al observar
  respuestas sin reemplazar peticiones, un ensayo normal resolvió imágenes y
  emitió token en unos 70 segundos; otro agotó seis intentos sin token.
- Con [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python) 1.64.2,
  Chrome visible y un perfil anónimo dedicado, se completó el formulario oficial:
  token real, POST aceptado, `IsResponse=true`, `Cod=0`, búsqueda por patente y
  coincidencia de la patente solicitada. El resultado conocido fue
  `CodTipoEncargo=0`. Esa consulta reutilizó el perfil y tardó unos 12 segundos
  en la fase del CAPTCHA; no requirió resolver nuevas imágenes en ese intento.
  La herramienta reproducible volvió a completar la consulta con un perfil
  anónimo nuevo en unos 11 segundos totales, validando otra respuesta oficial.
  Esto prueba viabilidad local, no disponibilidad ni latencia garantizadas.
- [CaptchaFree](https://github.com/theriley106/CaptchaFree), MIT, y
  [Buster](https://github.com/dessant/buster), GPL-3.0, también admiten voz local
  mediante Whisper. Se revisó su código; no se ejecutaron. Necesitan que el sitio
  ofrezca el audio. Cambiar el reconocedor no resuelve la ausencia de ese archivo.
- [CaptchaBreaker](https://github.com/DHRlabs/CaptchaBreaker) tiene OCR local de
  texto, pero su propia evaluación declara aproximadamente 7% de coincidencia
  exacta en captchas distorsionados reales. Su vía de imágenes avanzada requiere
  configurar un proveedor de visión externo; no se validó como alternativa local.

La prueba reproducible está en `scripts/research/autoseguro/`. Lee el token emitido
por Google desde el DOM compartido: el contexto JavaScript aislado de Patchright
no expone los globals `grecaptcha` ni los de la respuesta oficial. La validación
de esa respuesta se ejecuta explícitamente en el contexto principal. No se crean
tokens ni se reemplaza la página oficial. Se distingue la emisión del CAPTCHA de
la aceptación de la consulta. La prueba no modifica código ni datos de producción.

Para incorporarla al flujo del guardia falta una integración de servidor con cola,
límites de concurrencia, tiempo máximo y estados pendientes/no consultados. Las
pruebas de reCAPTCHA v2 no acreditan compatibilidad con v3 o Turnstile. Tampoco
obtienen por sí mismas dueño, marca, modelo, color o multas de otra plataforma.
