# Tareas por punto: fotos y respuesta automática

El supervisor configura cada tarea en **Tareas del turno**: recinto, punto,
pregunta y tipo de respuesta. Las opciones son **Sí / No**, **Argumento escrito**,
**Número** y **Solo fotos**. La opción adicional **Sí / No · avisar si NO** conserva
la alerta operativa que antes se mostraba como OK/Falla.

Un único selector decide si hay fotos. Cuando se requieren, el supervisor elige
el mínimo y el máximo (1–10); inicialmente se heredan **mínimo 1, máximo 3** de las
reglas de evidencia. El administrador puede cambiar los valores heredados por
empresa, recinto o punto. El máximo efectivo nunca queda por debajo del mínimo.

La app muestra una tarea a la vez. Las tareas de fotografía del punto aparecen
antes de sus preguntas, aunque el CSV original las haya traído en otro orden.
Cada captura se procesa con marca de agua, se guarda en IndexedDB y se intenta
subir inmediatamente. **Agregar foto** aparece
al regresar de cámara y desaparece al alcanzar el máximo. La pregunta se habilita
después del mínimo: tocar SÍ/NO encola y envía la respuesta completa; un argumento
o número tiene un solo botón verde **Enviar**. Solo fotos termina automáticamente
al cumplir el mínimo. No hay botón Guardar tarea ni una segunda cámara para la
foto general del punto si una tarea ya la exige.

Sin conexión se conservan fotos, texto y respuesta. El servidor no acepta la
respuesta hasta recibir todas las fotos capturadas y exige el mínimo configurado.
El estado de cada tarea se confirma en IndexedDB antes de avanzar en pantalla;
localStorage queda como caché y como origen para migrar borradores anteriores.
Las escrituras de una ronda se serializan y se espera el commit de la transacción,
no solo el éxito de su petición: un cierre forzado de Android puede revertir una
escritura reciente de localStorage aunque el archivo de la foto sí haya persistido.
Al reabrir se restaura el estado durable antes de sincronizar. Una captura antigua
sin referencia solo se recupera si el escaneo identifica una única tarea con foto;
no se asigna evidencia a una pregunta ambigua ni se envían argumentos sin pulsar Enviar.
Al reconectar, volver a la pantalla o recuperar el id de un escaneo, se reintenta
la cola. Un recibo persistente evita repetir la subida de una foto ya confirmada.
La recuperación también se ejecuta en la portada sin ronda asignada: consulta
los escaneos de las rondas con trabajo local y envía sus fotos y respuestas. El
servidor valida que cada ronda pertenezca al guardia de la sesión; el trabajo de
otra sesión se conserva y no se envía con la identidad nueva.
Los reenvíos de respuestas son idempotentes. Las fotos deben pertenecer a la misma
ronda y al punto de la tarea; no se admiten ids repetidos.

El editor publica una versión nueva al actualizar las tareas. La ronda conserva
su plantilla desde que la consulta; su cola y su informe siguen usando esa versión
aunque el supervisor cambie la configuración. Las tareas y respuestas históricas
no se reescriben. Las fotos adicionales se vinculan en una tabla append-only con
RLS forzado y claves compuestas por empresa; aparecen juntas en el anexo del PDF.

El cambio de tareas usa el puente existente. El Android **0.3.1 (8)** incorpora
además R8 y reducción de recursos en release para atender la advertencia de DEX;
los mapas se conservan como artefacto y dentro del AAB. El porcentaje definitivo
de Play debe comprobarse al procesar el nuevo archivo: no se deduce solo de activar
un flag. Referencias: [Android vitals](https://developer.android.com/google/play/vitals/code-optimization)
y [optimización con R8](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization).

El AAB firmado del 29 de octubre contiene **7,603 MiB de DEX** (el v7 tenía
30,43 MiB). Su `BUNDLE-METADATA/com.android.tools/r8.json` confirma optimización,
reducción y ofuscación activas, modo completo. Las métricas `noObfuscationPercentage`,
`noOptimizationPercentage` y `noShrinkingPercentage` son 17,64%, 18,09% y 17,48%
respectivamente. Son los porcentajes **sin** esas transformaciones; no deben
presentarse como si fueran los porcentajes ofuscados. La firma coincide con la
clave de subida del v7.

Los APK se generan a demanda; un push de cambios del servidor no vuelve a
compilar Gradle. APK y AAB cancelan una compilación anterior de la misma rama
cuando se pide otra, para evitar consumo duplicado de Actions.
