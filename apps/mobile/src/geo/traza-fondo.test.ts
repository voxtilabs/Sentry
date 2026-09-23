import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La traza de fondo que sobrevive a la ronda (visto en el telefono de prueba).
 *
 * El muestreo lo registra ANDROID, no el proceso: sigue vivo aunque el portal
 * se recargue, se quede sin WebView o muera la app. Con la ronda ya cerrada, el
 * telefono seguia despertando el GPS y mostrando la notificacion "Ronda en
 * curso" — lo contrario de lo que el aviso legal le promete al guardia, y lo
 * contrario de lo que se le declara a Google Play.
 *
 * Se prueba leyendo el fuente y no ejecutando la tarea: definirla exige
 * `expo-task-manager` y un runtime de Android. Lo que hay que fijar es la
 * DECISION —que un 4xx apaga el servicio y un 5xx no— y eso se lee.
 */
const fuente = readFileSync(join(__dirname, 'traza-fondo.ts'), 'utf8');

test('un 4xx del servidor apaga el servicio en primer plano', () => {
  // 4xx = esta ronda ya no acepta posiciones: cerrada, pausada o sin
  // consentimiento. El servidor es la autoridad, no el telefono.
  assert.match(fuente, /respuesta\.status >= 400 && respuesta\.status < 500/);
  const bloque = fuente.slice(fuente.indexOf('respuesta.status >= 400'));
  assert.match(bloque.slice(0, 260), /detenerTrazaEnSegundoPlano\(\)/);
});

test('un 5xx NO lo apaga: el servidor caido no es una ronda cerrada', () => {
  /*
   * Apagar la traza por un error pasajero perderia el recorrido de verdad,
   * que es justo lo que este producto existe para acreditar.
   */
  assert.doesNotMatch(fuente, /status >= 500[\s\S]{0,120}detenerTrazaEnSegundoPlano/);
});

test('el destino se olvida al apagar, para que un tick tardio no lo reviva', () => {
  const bloque = fuente.slice(fuente.indexOf('respuesta.status >= 400'));
  assert.match(bloque.slice(0, 260), /destino = null/);
});

test('el fallo de red sigue sin apagar nada: el guardia trabaja sin señal', () => {
  // El catch existe y no toca el servicio: sin señal la ronda continua y las
  // posiciones se reintentan en el proximo tick.
  const captura = fuente.slice(fuente.indexOf('} catch (fallo) {'));
  assert.doesNotMatch(captura.slice(0, 400), /detenerTrazaEnSegundoPlano/);
});
