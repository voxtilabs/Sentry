# Consulta vehicular en el servidor

La app llama a la API autenticada; la API valida guardia, empresa y recinto y encola
la consulta en BullMQ. Devuelve un identificador inmediatamente. La ficha básica
se publica como progreso y el resultado final se añade a PostgreSQL sin modificar
la evidencia inicial. Una visita registrada durante la consulta conserva el enlace
al resultado aunque el teléfono cierre la vista o pierda conexión.

Fuentes: Restart (`https://api.restart.cl/docs`, API gratuita sin clave, límite
documentado de 5 consultas/10 segundos/IP), AutoSign y CIPAT. CIPAT es comunitario,
no acredita ausencia de encargo oficial. Restart aporta marca, modelo, año y la
revisión más reciente; se descartan certificados y otros identificadores.

Este servicio privado ejecuta el formulario público de Auto Seguro con Patchright,
Chrome y reCognizer local. Solo se acepta un estado oficial después de obtener un
token real, enviar el formulario y validar código, patente y fecha de la respuesta.
Un CAPTCHA rechazado, un error o un formato nuevo producen **no consultado**.
No hay garantía de disponibilidad, ni se obtienen dueño, color o multas por esta vía.

## Activación en Dokploy

Configurar en el entorno del stack, sin guardar la credencial en Git:

```dotenv
COMPOSE_PROFILES=vehicle-lookup
VEHICLE_LOOKUP_WORKER_URL=http://vehicle-lookup:8090
VEHICLE_LOOKUP_WORKER_TOKEN=<secreto aleatorio de al menos 32 caracteres>
```

Conservar otros perfiles ya activados, separados por coma. Desplegar
`docker-compose.dokploy.yml`. El servicio no publica puertos y solo la API conoce
su credencial. El volumen `vehicle_lookup_data` conserva un perfil anónimo dedicado
y pesos, sin usar sesiones personales. El primer inicio descarga un modelo de unos
6 MB. El healthcheck responde cuando termina esta preparación. Límites: una
consulta de navegador simultánea, cola interna de ocho, tiempo máximo por proceso,
3 GB y dos CPU. Cache de resultado válido cinco minutos; fallido, treinta segundos.
El contenedor corre como usuario sin privilegios.

El perfil CPU aplica `prepare_light_models.py` sobre la referencia GPL-3.0 fijada
de [reCognizer](https://github.com/Vinyzu/recognizer). Carga YOLO11n-seg y omite
desafíos de clases no soportadas dentro del límite de seis intentos; no descarga
CLIP/CLIPSeg. La adaptación comprueba el código esperado al construir y falla si
la dependencia cambió. La herramienta local original puede usar los modelos
completos. Ningún acierto del detector se convierte por sí solo en un resultado
vehicular: siempre se exige la respuesta oficial aceptada.

## Verificación y operación

```sh
python -m unittest discover -s services/vehicle-lookup -p 'test_*.py'
```

La prueba de límites HTTP requiere `psutil`, incluido por las dependencias del
contenedor; no requiere navegador ni modelos. La consulta real usa una patente
autorizada mediante `scripts/research/autoseguro/lookup.py`; guardar resultados fuera
del repositorio con permisos 0600. No registrar patentes, tokens, cookies ni imágenes.

POST `/visits/guard/vehicle` inicia la consulta; GET
`/visits/guard/vehicle/:lookupId` devuelve progreso o resultado con los mismos
permisos. Los trabajos en Redis caducan; los resultados conservados con una visita
siguen la retención configurada por empresa. La migración de retención mantiene
ambas evidencias hasta que venza la visita. No amplía permisos de escritura.

Para desactivar el navegador, vaciar `VEHICLE_LOOKUP_WORKER_URL`, quitar solo el
perfil `vehicle-lookup` y redesplegar. Las consultas básicas siguen funcionando y
el encargo oficial aparece como no consultado. No requiere actualizar el AAB.
