import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { leerCaidas, usarColaEnMemoria } from './cola-de-caidas';
import {
  endpointDeCaidas,
  formatearErrorParaReporte,
  instalarReportadorGlobal,
  registrarArranqueYVerificarCierre,
  reiniciarEstadoDelReportador,
  reportarCaida,
  setStorageAdapter,
  vaciarColaDeCaidas,
  veredictoDeRespuesta,
  type StorageAdapter,
} from './crash-reporter';
import { sanitizarTexto } from './scrubber';

const storeMock = new Map<string, string>();
const fakeStorage: StorageAdapter = {
  getItemAsync: async (k: string) => storeMock.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    storeMock.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    storeMock.delete(k);
  },
};

setStorageAdapter(fakeStorage);

beforeEach(() => {
  storeMock.clear();
  // La cola real vive en la base cifrada del telefono (expo-sqlite), que no
  // existe corriendo en Node: aca se usa la misma cola en memoria a la que
  // cae un telefono sin base.
  usarColaEnMemoria();
  reiniciarEstadoDelReportador();
});

test('sanitizarTexto elimina correos, tokens Bearer, JWT y cookies sensibles', () => {
  const texto =
    'Error at guard@sentrycore.com with Authorization: Bearer secret_token_123 and cookie connect.sid=s%3A123 and jwt eyJhbGciOi.eyJzdWIi.signature';
  const limpio = sanitizarTexto(texto);

  assert.ok(!limpio.includes('guard@sentrycore.com'));
  assert.ok(!limpio.includes('secret_token_123'));
  assert.ok(!limpio.includes('connect.sid=s%3A123'));
  assert.ok(limpio.includes('[EMAIL_REDACTED]'));
  assert.ok(limpio.includes('Bearer [REDACTED]'));
  assert.ok(limpio.includes('connect.sid=[REDACTED]'));
  assert.ok(limpio.includes('[JWT_REDACTED]'));
});

test('sanitizarTexto redacta las cookies REALES del producto, no solo connect.sid (#321)', () => {
  // El refresh es randomBytes(48).toString('base64url'): no es un JWT, asi
  // que ningun otro patron lo toca si no esta explicito.
  const refresh = 'kQ3f9j_2mZ-abcDEF012345_-xyzKLMN678opqRSTU-9012vwYZ34';
  const texto = `Cookie: sentrycore_access=eyJhbGciOi.eyJzdWIi.signature; sentrycore_refresh=${refresh}`;
  const limpio = sanitizarTexto(texto);

  assert.ok(!limpio.includes(refresh));
  assert.ok(limpio.includes('sentrycore_refresh=[REDACTED]'));
  // El access token es JWT: cae en PATRON_JWT antes de llegar a PATRON_COOKIE.
  assert.ok(!limpio.includes('eyJhbGciOi.eyJzdWIi.signature'));
});

test('sanitizarTexto elimina contraseñas, claves, pines, secretos y rutas personales', () => {
  const texto =
    'Failed login with password="super_secret_password" and pin: 9876 and api_key="secret_api_key" at /home/jorge_guard/project/src/index.ts';
  const limpio = sanitizarTexto(texto);

  assert.ok(!limpio.includes('super_secret_password'));
  assert.ok(!limpio.includes('9876'));
  assert.ok(!limpio.includes('secret_api_key'));
  assert.ok(!limpio.includes('jorge_guard'));
  assert.ok(limpio.includes('password=[REDACTED]'));
  assert.ok(limpio.includes('pin=[REDACTED]'));
  assert.ok(limpio.includes('api_key=[REDACTED]'));
  assert.ok(limpio.includes('/home/[USUARIO_REDACTED]'));
});

test('formatearErrorParaReporte genera payload conforme al contrato de ReportCrashDto', () => {
  const error = new TypeError('Cannot read properties of undefined (reading scan)');
  const payload = formatearErrorParaReporte(error, { fatal: true });

  assert.equal(payload.errorName, 'TypeError');
  assert.equal(payload.errorMessage, 'Cannot read properties of undefined (reading scan)');
  assert.equal(payload.fatal, true);
  assert.ok(payload.appVersion.length >= 1 && payload.appVersion.length <= 32);
  assert.ok(payload.deviceModel.length >= 1 && payload.deviceModel.length <= 64);
  assert.ok(payload.androidVersion.length >= 1 && payload.androidVersion.length <= 32);
  assert.equal(typeof payload.bridgeProtocolVersion, 'number');
  assert.ok(payload.occurredAt && !isNaN(Date.parse(payload.occurredAt)));
});

test('formatearErrorParaReporte maneja errores que son strings u objetos sin fallar', () => {
  const payloadStr = formatearErrorParaReporte('Fallo en sincronización');
  assert.equal(payloadStr.errorName, 'Error');
  assert.equal(payloadStr.errorMessage, 'Fallo en sincronización');

  const payloadObj = formatearErrorParaReporte({ codigo: 500, detalle: 'timeout' });
  assert.equal(payloadObj.errorName, 'Error');
  assert.ok(payloadObj.errorMessage.includes('timeout'));
});

test('formatearErrorParaReporte respeta topes de longitud máximos del backend', () => {
  const errorLargo = new Error('A'.repeat(5_000));
  errorLargo.name = 'B'.repeat(200);
  const payload = formatearErrorParaReporte(errorLargo, { stackManual: 'C'.repeat(50_000) });

  assert.ok(payload.errorName.length <= 120);
  assert.ok(payload.errorMessage.length <= 4_000);
  assert.ok((payload.stack?.length ?? 0) <= 40_000);
});

test('reportarCaida sin apiUrl encola la caída para reintento offline', async () => {
  const error = new Error('Caída en subterráneo sin señal');
  await reportarCaida(error, { fatal: false });

  const encoladas = await leerCaidas();
  assert.equal(encoladas.length, 1);
  assert.equal(encoladas[0]?.payload.errorMessage, 'Caída en subterráneo sin señal');
});

test('vaciarColaDeCaidas despacha los reportes pendientes cuando hay apiUrl', async () => {
  await reportarCaida(new Error('Error guardado sin señal'), { fatal: false });

  const llamadas: unknown[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ received: true }), { status: 201 });
  }) as typeof fetch;

  try {
    await vaciarColaDeCaidas('http://api.local');
    assert.equal(llamadas.length, 1);
    assert.equal(
      (llamadas[0] as { url: string }).url,
      'http://api.local/api/observability/crash-reports',
    );
    assert.deepEqual(await leerCaidas(), []);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('instalarReportadorGlobal registra el manejador respetando el handler previo (no fatal)', async () => {
  let handlerPrevioLlamado = false;
  const handlerPrevio = () => {
    handlerPrevioLlamado = true;
  };

  let handlerInstalado: ((error: Error, isFatal?: boolean) => void) | undefined;

  const globalAny = global as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    };
  };

  globalAny.ErrorUtils = {
    getGlobalHandler: () => handlerPrevio,
    setGlobalHandler: (h) => {
      handlerInstalado = h;
    },
  };

  // Mockeado y esperado a propósito: el camino no-fatal dispara
  // reportarCaida() como fire-and-forget (`void`), y sin mock hace un fetch
  // REAL a 'http://api.local' que sigue vivo de fondo después de que el test
  // termina — y termina escribiendo en la cola de OTRO test que corre
  // después (así se descubrió el hallazgo de #321: dos entradas donde se
  // esperaba una).
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ received: true }), { status: 201 })) as typeof fetch;

  try {
    instalarReportadorGlobal(() => 'http://api.local');

    assert.ok(handlerInstalado);
    handlerInstalado(new Error('Test unhandled'), false);
    assert.equal(handlerPrevioLlamado, true);

    // Deja que el reportarCaida() fire-and-forget termine antes de restaurar
    // fetch y de que el siguiente test arranque.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('instalarReportadorGlobal ante un error FATAL encola antes de ceder el proceso al handler previo (#321)', async () => {
  let handlerPrevioLlamado = false;
  const handlerPrevio = () => {
    handlerPrevioLlamado = true;
  };

  let handlerInstalado: ((error: Error, isFatal?: boolean) => void) | undefined;

  const globalAny = global as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    };
  };

  globalAny.ErrorUtils = {
    getGlobalHandler: () => handlerPrevio,
    setGlobalHandler: (h) => {
      handlerInstalado = h;
    },
  };

  // Simula que ni siquiera hay red: lo que importa es que la caida haya
  // quedado en la cola ANTES de que se ceda el proceso, sin importar si el
  // envio inmediato tuvo suerte.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('sin red');
  }) as typeof fetch;

  try {
    instalarReportadorGlobal(() => 'http://api.local');
    assert.ok(handlerInstalado);

    handlerInstalado(new Error('Fatal en el escaneo'), true);

    // El proceso NO se cede en el mismo tick: si esto fuera sincronico (como
    // antes), un handlerPrevio real de React Native mataria el proceso antes
    // de que la escritura en cola llegue a completarse, y la caida fatal se
    // perderia sin dejar rastro.
    assert.equal(handlerPrevioLlamado, false);

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(handlerPrevioLlamado, true);

    const encoladas = await leerCaidas();
    assert.equal(encoladas.length, 1);
    assert.equal(encoladas[0]?.payload.errorMessage, 'Fatal en el escaneo');
    assert.equal(encoladas[0]?.payload.fatal, true);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('el POST va a la ruta REAL de la API, no a /crash-reports (#273)', () => {
  // La version anterior mandaba a `${origen}/crash-reports`: 404 en cada
  // caida, descartada en silencio por no ser 5xx. La app "tenia" reporte de
  // caidas y el panel nunca vio una.
  assert.equal(
    endpointDeCaidas('https://sentrycore.voxtilabs.cl'),
    'https://sentrycore.voxtilabs.cl/api/observability/crash-reports',
  );
  // El portal entrega por el puente una base que YA trae /api: configurar una
  // u otra no puede cambiar el destino.
  assert.equal(
    endpointDeCaidas('https://sentrycore.voxtilabs.cl/api'),
    'https://sentrycore.voxtilabs.cl/api/observability/crash-reports',
  );
  assert.equal(
    endpointDeCaidas('https://sentrycore.voxtilabs.cl/api/'),
    'https://sentrycore.voxtilabs.cl/api/observability/crash-reports',
  );
});

test('el POST declara el Origin del portal o el servidor lo rechaza por CSRF (#273)', async () => {
  const cabeceras: Record<string, string>[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    cabeceras.push((init?.headers ?? {}) as Record<string, string>);
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    await reportarCaida(new Error('con origen'), { apiUrl: 'https://portal.cl' });
    // `csrf-origin.middleware` solo deja pasar sin Origin a un cliente nativo
    // SIN cookies, y este fetch va con las del WebView: sin esta cabecera es
    // 403 siempre.
    assert.equal(cabeceras[0]?.Origin, 'https://portal.cl');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('el veredicto separa lo que puede valer despues de lo que no valdra nunca (#273)', () => {
  assert.equal(veredictoDeRespuesta(202), 'entregado');
  // Todavia no hay sesion: el arranque reporta la caida de ayer antes del login.
  assert.equal(veredictoDeRespuesta(401), 'reintentar');
  // El techo por usuario/hora del servidor se libera solo.
  assert.equal(veredictoDeRespuesta(429), 'reintentar');
  assert.equal(veredictoDeRespuesta(503), 'reintentar');
  // El cuerpo no cumple el contrato y no lo va a cumplir en el proximo intento.
  assert.equal(veredictoDeRespuesta(400), 'descartar');
  // Modulo apagado para la empresa.
  assert.equal(veredictoDeRespuesta(404), 'descartar');
  assert.equal(veredictoDeRespuesta(403), 'descartar');
});

test('con el modulo apagado deja de intentar hasta el proximo arranque (#273)', async () => {
  let intentos = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    intentos += 1;
    return new Response(
      JSON.stringify({ message: 'Esta seccion no esta disponible para tu empresa' }),
      { status: 404 },
    );
  }) as typeof fetch;

  try {
    await reportarCaida(new Error('primera'), { apiUrl: 'https://portal.cl' });
    await reportarCaida(new Error('segunda'), { apiUrl: 'https://portal.cl' });
    await reportarCaida(new Error('tercera'), { apiUrl: 'https://portal.cl' });

    // Una sola ida al servidor: sin el pestillo, el telefono golpea un 404 por
    // cada caida y por cada vuelta a primer plano, gastando bateria del
    // guardia en contar que la empresa no quiere el modulo.
    assert.equal(intentos, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('sin señal la caida espera en cola y sale despues (#273)', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('Network request failed');
  }) as typeof fetch;

  try {
    await reportarCaida(new Error('caida en el subterraneo'), { apiUrl: 'https://portal.cl' });
    assert.equal((await leerCaidas()).length, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const enviadas: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    enviadas.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    await vaciarColaDeCaidas('https://portal.cl');
    assert.equal(enviadas.length, 1);
    assert.equal((enviadas[0] as { errorMessage: string }).errorMessage, 'caida en el subterraneo');
    assert.deepEqual(await leerCaidas(), []);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('una caida vieja se tira sin gastar la red del guardia (#273)', async () => {
  const { encolarCaida } = await import('./cola-de-caidas');
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000).toISOString();
  await encolarCaida({ errorName: 'Vieja', errorMessage: 'de la semana pasada' }, hace10Dias);

  let intentos = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    intentos += 1;
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    await vaciarColaDeCaidas('https://portal.cl');
    assert.equal(intentos, 0);
    assert.deepEqual(await leerCaidas(), []);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('la caida NATIVA se reporta como tal y no como un JSON pegado (#273)', async () => {
  // Antes se pasaba el payload ya armado por formatearErrorParaReporte(), que
  // lo trataba como un objeto cualquiera: el reporte entero terminaba dentro
  // de `errorMessage` y el nombre volvia a ser 'Error'. En el panel la caida
  // que mato el proceso se veia igual que cualquier otra.
  storeMock.set('sentrycore.clean_exit.v1', 'false');

  const enviadas: Record<string, unknown>[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    enviadas.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    await registrarArranqueYVerificarCierre('https://portal.cl');
    assert.equal(enviadas.length, 1);
    assert.equal(enviadas[0]?.errorName, 'NativeCrash');
    assert.equal(enviadas[0]?.fatal, true);
    assert.ok(!String(enviadas[0]?.errorMessage).includes('{'));
    // Y queda marcada la corrida actual como en curso, para detectar la proxima.
    assert.equal(storeMock.get('sentrycore.clean_exit.v1'), 'false');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('el reporte no lleva NADA del guardia: solo los campos del contrato (#273)', async () => {
  const enviadas: Record<string, unknown>[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    enviadas.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    await reportarCaida(new Error('fallo al escanear'), { apiUrl: 'https://portal.cl' });
    const permitidos = new Set([
      'errorName',
      'errorMessage',
      'stack',
      'appVersion',
      'deviceModel',
      'androidVersion',
      'bridgeProtocolVersion',
      'fatal',
      'occurredAt',
    ]);
    // Se comprueba mirando el JSON que SALE, no confiando en el scrubber del
    // servidor: esa es la promesa del issue y es la unica forma de verla.
    for (const clave of Object.keys(enviadas[0] ?? {})) {
      assert.ok(permitidos.has(clave), `el reporte no deberia llevar "${clave}"`);
    }
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
