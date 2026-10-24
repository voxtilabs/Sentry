import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateEnv } from './env';

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:unique-password@postgres:5432/sentrycore',
  REDIS_URL: 'redis://:another-unique-password@redis:6379',
  JWT_SECRET: 'a-secure-and-unique-production-secret-with-48-characters',
  MAIL_DRIVER: 'smtp',
  MAIL_FROM: 'SentryCore <no-reply@example.test>',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  WEB_PUBLIC_URL: 'https://control.example.test',
};

/** Los drivers que el esquema acepta, leidos del propio codigo fuente. */
const MAIL_DRIVERS: string[] = (() => {
  const fuente = readFileSync(join(__dirname, 'env.ts'), 'utf8');
  const m = /MAIL_DRIVER:\s*z\.enum\(\[([^\]]+)\]\)/.exec(fuente);
  if (!m?.[1]) throw new Error('no encontre el enum de MAIL_DRIVER');
  return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1] as string);
})();

describe('validateEnv', () => {
  it('acepta un entorno de producción completo y seguro', () => {
    expect(validateEnv(valid)).toMatchObject({ NODE_ENV: 'production', SMTP_SECURE: true });
  });

  it.each([
    ['DATABASE_URL', undefined],
    ['REDIS_URL', undefined],
    ['JWT_SECRET', undefined],
  ])('falla rápido si falta %s', (key, value) => {
    expect(() => validateEnv({ ...valid, [key]: value })).toThrow(
      'Configuracion de entorno invalida',
    );
  });

  it('rechaza secretos de ejemplo en staging y producción', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'cambiar_por_un_secreto_largo_ahora' })).toThrow(
      'no permite credenciales de ejemplo',
    );
  });

  it('rechaza correo local o sin cifrar en producción', () => {
    expect(() => validateEnv({ ...valid, MAIL_DRIVER: 'mailpit' })).toThrow(
      'no puede ser mailpit',
    );
    expect(() => validateEnv({ ...valid, SMTP_SECURE: 'false' })).toThrow(
      'SMTP_SECURE=true',
    );
  });

  /*
   * La guarda de produccion tiene que prohibir el driver que NO ENTREGA, no
   * exigir uno en concreto. Decia `!== 'smtp'` porque smtp era el unico real,
   * y al agregar `resend` empezo a rechazar un driver legitimo: la API se
   * negaba a arrancar y tumbo produccion dos veces.
   *
   * Esta prueba recorre TODOS los drivers que el esquema acepta, asi que el
   * proximo que se agregue entra sola.
   */
  it('deja arrancar en producción con cualquier driver que sí entregue', () => {
    const entregan = MAIL_DRIVERS.filter((d) => d !== 'mailpit');
    expect(entregan.length).toBeGreaterThan(1);

    for (const driver of entregan) {
      expect(() =>
        validateEnv({ ...valid, MAIL_DRIVER: driver, RESEND_API_KEY: 're_llave_de_prueba' }),
      ).not.toThrow();
    }
  });

  it('cada driver exige sus propias credenciales', () => {
    expect(() => validateEnv({ ...valid, MAIL_DRIVER: 'resend', RESEND_API_KEY: '' })).toThrow(
      'RESEND_API_KEY',
    );
    expect(() => validateEnv({ ...valid, MAIL_DRIVER: 'smtp', SMTP_HOST: '' })).toThrow(
      'SMTP_HOST',
    );
  });

  describe('dominios que no se despachan (#86)', () => {
    it('no deja abrir la escotilla de dominios reservados con un relay real', () => {
      // La escotilla es para Mailpit, que captura todo. Con SMTP detras, abrirla
      // es autorizarse a escribirle a dominios que rebotan siempre (.test de las
      // cuentas demo), y el rebote duro es lo que le cuesta la cuenta de correo a
      // TODA la plataforma. Tiene que doler al arrancar, no cuando dejan de
      // llegar los correos de los clientes que pagan.
      expect(() =>
        validateEnv({ ...valid, MAIL_ALLOW_RESERVED_DOMAINS: 'true' }),
      ).toThrow('MAIL_ALLOW_RESERVED_DOMAINS solo se permite con MAIL_DRIVER=mailpit');
    });

    it('con Mailpit la escotilla se puede abrir', () => {
      expect(
        validateEnv({
          ...valid,
          NODE_ENV: 'development',
          MAIL_DRIVER: 'mailpit',
          MAIL_ALLOW_RESERVED_DOMAINS: 'true',
        }),
      ).toMatchObject({ MAIL_ALLOW_RESERVED_DOMAINS: true });
    });

    it('un valor ambiguo no arranca en vez de quedar en silencio', () => {
      // Antes se leia suelto de process.env y cualquier cosa distinta de 'true'
      // se tomaba como false sin avisar. Un '1' escrito por alguien que creia
      // estar abriendo la escotilla ahora se ve al arrancar.
      expect(() => validateEnv({ ...valid, MAIL_ALLOW_RESERVED_DOMAINS: '1' })).toThrow(
        'Configuracion de entorno invalida',
      );
    });

    it('el default protege sin configurar nada', () => {
      expect(validateEnv(valid)).toMatchObject({
        MAIL_BLOCKED_DOMAINS: '',
        MAIL_ALLOW_RESERVED_DOMAINS: false,
      });
    });
  });
});

describe('validateEnv · webhook de estado de entrega (#220)', () => {
  it('arranca sin el secreto: el canal queda apagado, no el producto', () => {
    // Sin secreto el endpoint publico responde 503 a todo. Negarse a arrancar
    // cambiaria "un aviso que no llega" por "un producto que no levanta".
    const env = validateEnv(valid);

    expect(env.NOTIF_WEBHOOK_DRIVER).toBe('interno');
    expect(env.NOTIF_WEBHOOK_SECRET).toBeUndefined();
  });

  it('trata el valor vacio como ausente: copiar .env.example tiene que levantar', () => {
    expect(validateEnv({ ...valid, NOTIF_WEBHOOK_SECRET: '' })).toMatchObject({
      NOTIF_WEBHOOK_SECRET: undefined,
    });
  });

  it('rechaza un secreto compartido corto, que es un HMAC de adorno', () => {
    expect(() => validateEnv({ ...valid, NOTIF_WEBHOOK_SECRET: 'corto' })).toThrow(
      'al menos 32 caracteres',
    );
  });

  it('rechaza un driver sin traductor antes de recibir el primer webhook', () => {
    expect(() => validateEnv({ ...valid, NOTIF_WEBHOOK_DRIVER: 'sendgrid' })).toThrow(
      'Configuracion de entorno invalida',
    );
  });
});
