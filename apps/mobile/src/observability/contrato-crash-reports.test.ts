import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { endpointDeCaidas, formatearErrorParaReporte, RUTA_CAIDAS } from './crash-reporter';

/**
 * El telefono y la API viven en paquetes distintos y nadie los compila juntos:
 * el TypeScript de la app no sabe que existe `CrashReportsController`. Esa
 * frontera fue exactamente el fallo de #273 — la app posteaba a una ruta que
 * el servidor no expone, y la prueba de la app afirmaba la ruta EQUIVOCADA
 * porque se escribio mirando el codigo de la app.
 *
 * Aca se lee el fuente de la API de verdad. Si alguien mueve el controlador o
 * agrega un campo obligatorio al DTO, esto falla en el CI y no en el telefono
 * de un guardia.
 */
const API = join(__dirname, '..', '..', '..', 'api', 'src', 'observability');
const controlador = readFileSync(join(API, 'crash-reports.controller.ts'), 'utf8');
const dto = readFileSync(join(API, 'dto', 'report-crash.dto.ts'), 'utf8');

test('la ruta que usa el telefono es la que expone la API', () => {
  const prefijo = /@Controller\('([^']+)'\)/.exec(controlador)?.[1];
  const sufijo = /@Post\('([^']+)'\)/.exec(controlador)?.[1];
  assert.ok(prefijo, 'no se pudo leer el @Controller de la API');
  assert.ok(sufijo, 'no se pudo leer el @Post de la API');
  assert.equal(RUTA_CAIDAS, `/${prefijo}/${sufijo}`);
  assert.equal(
    endpointDeCaidas('https://sentrycore.voxtilabs.cl'),
    `https://sentrycore.voxtilabs.cl/api/${prefijo}/${sufijo}`,
  );
});

test('el telefono manda todos los campos que el DTO exige', () => {
  // `whitelist: true` con `forbidNonWhitelisted: true` en el ValidationPipe
  // global: un campo de menos es 400 y uno de mas tambien.
  const obligatorios = [...dto.matchAll(/^\s{2}(\w+)!:/gm)].map((m) => m[1]);
  assert.ok(obligatorios.length >= 5, 'el DTO dejo de declararse como se esperaba');

  const payload = formatearErrorParaReporte(new Error('x'), { fatal: true }) as unknown as Record<
    string,
    unknown
  >;
  for (const campo of obligatorios) {
    assert.ok(
      payload[campo!] !== undefined && payload[campo!] !== '',
      `la app no manda "${campo}", que el DTO exige`,
    );
  }
});

test('el telefono no inventa campos que el servidor rechazaria', () => {
  const declarados = new Set([...dto.matchAll(/^\s{2}(\w+)[!?]:/gm)].map((m) => m[1]));
  const payload = formatearErrorParaReporte(new Error('x'), { stackManual: 'y' });
  for (const campo of Object.keys(payload)) {
    assert.ok(declarados.has(campo), `"${campo}" no existe en ReportCrashDto: seria un 400`);
  }
});

test('los topes de largo del telefono son los del DTO', () => {
  const topeDe = (campo: string) => {
    const bloque = dto.slice(dto.indexOf(`  ${campo}`) - 900, dto.indexOf(`  ${campo}`));
    const largo = /@Length\(\s*[\d_]+\s*,\s*([\d_]+)\s*\)/g;
    const encontrados = [...bloque.matchAll(largo)];
    return Number(encontrados.at(-1)?.[1]?.replace(/_/g, '') ?? NaN);
  };

  const errorLargo = new Error('A'.repeat(9_000));
  errorLargo.name = 'B'.repeat(400);
  const payload = formatearErrorParaReporte(errorLargo, { stackManual: 'C'.repeat(80_000) });

  assert.ok(payload.errorName.length <= topeDe('errorName!'));
  assert.ok(payload.errorMessage.length <= topeDe('errorMessage!'));
  assert.ok((payload.stack?.length ?? 0) <= topeDe('stack?'));
});
