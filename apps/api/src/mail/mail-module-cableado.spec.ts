/**
 * Toda variable del entorno de correo tiene que LEERSE del ConfigService.
 *
 * `createMailProvider` recibe un objeto armado a mano en la fabrica del modulo.
 * Si se agrega un campo al tipo `MailEnvironment` y se olvida la linea
 * `CAMPO: config.get('CAMPO')`, el compilador no dice nada —el campo puede ser
 * opcional— y el valor llega `undefined` en produccion.
 *
 * Paso con RESEND_API_KEY: la llave estaba en el entorno del contenedor, pero
 * nadie la leia. La validacion la vio vacia, lanzo al inicializar el modulo y
 * la API entro en bucle de reinicio con el sitio en 404.
 *
 * Las pruebas de `createMailProvider` no lo atrapan porque le pasan el objeto
 * ya construido: prueban la funcion, no el cable que la alimenta.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUENTE = readFileSync(join(__dirname, 'mail.module.ts'), 'utf8');

/** Los campos que `MailEnvironment` declara, leidos del propio archivo. */
function camposDelTipo(): string[] {
  const bloque = /type MailEnvironment = Pick<\s*Env,([\s\S]*?)>;/.exec(FUENTE);
  if (!bloque?.[1]) throw new Error('no encontre la declaracion de MailEnvironment');
  return [...bloque[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1] as string);
}

describe('la fábrica del módulo lee todo lo que su tipo declara', () => {
  const campos = camposDelTipo();

  it('el tipo declara campos (si no, esta prueba no estaría probando nada)', () => {
    expect(campos.length).toBeGreaterThan(5);
  });

  it.each(camposDelTipo())('%s se lee del ConfigService', (campo) => {
    const leido = new RegExp(`${campo}:\\s*config\\.get\\(\\s*'${campo}'`).test(FUENTE);

    expect(leido).toBe(true);
  });
});
