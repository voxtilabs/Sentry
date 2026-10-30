/**
 * La llave de Resend tiene que llegar a los DOS composes.
 *
 * Es el mismo cuidado que ya se le tiene a `LOGIN_CODE_PEPPER` y a
 * `MAP_TILE_URL`, pero aqui el fallo es PEOR: con `MAIL_DRIVER=resend` la API
 * se niega a arrancar sin la llave —a proposito, porque un correo que no sale
 * es peor callado—. Si la variable esta en el entorno de Dokploy pero no en el
 * compose, no llega al contenedor: la API entra en bucle de reinicio y el sitio
 * entero queda en 404.
 *
 * Esta prueba existe porque eso PASO: se cambio MAIL_DRIVER a resend sin
 * agregar la linea al compose y produccion se cayo.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..', '..', '..');
const COMPOSES = ['docker-compose.dokploy.yml', 'docker-compose.production.yml'];

describe('RESEND_API_KEY llega al despliegue', () => {
  for (const archivo of COMPOSES) {
    const texto = readFileSync(join(RAIZ, archivo), 'utf8');

    it(`${archivo} se la pasa al contenedor`, () => {
      // La CLAVE, no el texto suelto: `${RESEND_API_KEY}` contiene el nombre
      // igual, y un `toContain` pasaria aunque el contenedor no la reciba.
      const declarada = texto
        .split('\n')
        .some((linea) => /^\s*RESEND_API_KEY:\s*\$\{RESEND_API_KEY/.test(linea));

      expect(declarada).toBe(true);
    });
  }

  it('el ejemplo de configuración la trae, para que nadie la descubra en producción', () => {
    const ejemplo = readFileSync(join(RAIZ, '.env.example'), 'utf8');

    expect(ejemplo).toMatch(/^RESEND_API_KEY=/m);
  });

  it('el ejemplo explica que existe el driver resend', () => {
    // Un driver que no esta documentado no lo elige nadie, y este resuelve un
    // problema concreto: servidores con el SMTP de salida bloqueado.
    const ejemplo = readFileSync(join(RAIZ, '.env.example'), 'utf8');

    expect(ejemplo).toMatch(/resend/i);
  });
});
