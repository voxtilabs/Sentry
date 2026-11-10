import { PROTOCOLO_MAJOR } from '../bridge/protocol';
import mobilePackage from '../../package.json';
import { borrarCaidas, encolarCaida, leerCaidas } from './cola-de-caidas';
import { recortar, sanitizarTexto } from './scrubber';

export interface ReportCrashPayload {
  errorName: string;
  errorMessage: string;
  stack?: string;
  appVersion: string;
  deviceModel: string;
  androidVersion: string;
  bridgeProtocolVersion?: number;
  fatal?: boolean;
  occurredAt?: string;
}

export interface StorageAdapter {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

const STORAGE_CLEAN_EXIT = 'sentrycore.clean_exit.v1';

/**
 * La ruta REAL del servidor. `CrashReportsController` vive en el controlador
 * `observability` y la API se publica bajo `/api` en el mismo origen del
 * portal. La version anterior mandaba a `${origen}/crash-reports`, que no
 * existe: cada caida se iba a un 404 y, como el reportador solo reintentaba
 * los 5xx, se descartaba en silencio. La app "tenia" reporte de caidas y el
 * panel no vio ninguna nunca.
 *
 * `contrato-crash-reports.test.ts` lee el controlador de la API y falla si la
 * ruta cambia de lado.
 */
export const RUTA_CAIDAS = '/observability/crash-reports';

/** Una caida guardada mas de esto ya no sirve para diagnosticar nada. */
export const VIGENCIA_DE_UNA_CAIDA_MS = 7 * 24 * 60 * 60 * 1_000;

let PlatformActual: {
  OS: string;
  Version?: number | string;
  constants?: { Model?: string; Brand?: string; Manufacturer?: string };
} = {
  OS: 'android',
  Version: '13',
  constants: { Model: 'Android Device', Brand: 'Generic' },
};

let AppStateActual: {
  addEventListener: (
    type: string,
    listener: (state: string) => void,
  ) => { remove?: () => void } | void;
} = {
  addEventListener: () => {},
};

let SecureStoreActual: StorageAdapter = {
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
};

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn = require('react-native');
  if (rn?.Platform) PlatformActual = rn.Platform;
  if (rn?.AppState) AppStateActual = rn.AppState;
} catch {
  // Fallback seguro si react-native no está presente en el entorno
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ss = require('expo-secure-store');
  if (ss?.getItemAsync) SecureStoreActual = ss;
} catch {
  // Fallback seguro
}

let storageActivo: StorageAdapter = SecureStoreActual;

export function setStorageAdapter(adapter: StorageAdapter): void {
  storageActivo = adapter;
}

export function setPlatformMock(mock: typeof PlatformActual): void {
  PlatformActual = mock;
}

let apiUrlActual: string | null = null;
let enviandoCaida = false;
let apagadoHastaElProximoArranque = false;

export function configurarApiUrl(url: string | null): void {
  if (url) {
    apiUrlActual = url.replace(/\/+$/, '');
  }
}

/** Solo para las pruebas: devuelve el reportador al estado de recien arrancado. */
export function reiniciarEstadoDelReportador(): void {
  apiUrlActual = null;
  enviandoCaida = false;
  apagadoHastaElProximoArranque = false;
}

/**
 * A donde va el POST.
 *
 * `App.tsx` configura el ORIGEN del portal, que es lo unico que el shell sabe
 * con certeza antes de que la web arranque; la API cuelga de `/api` en ese
 * mismo origen. Se acepta tambien una base que ya venga con `/api` —la que el
 * portal entrega por el puente— para que configurar una u otra no cambie el
 * resultado.
 */
export function endpointDeCaidas(base: string): string {
  const limpia = base.replace(/\/+$/, '');
  const conApi = /\/api$/.test(limpia) ? limpia : `${limpia}/api`;
  return `${conApi}${RUTA_CAIDAS}`;
}

function cabeceras(base: string): Record<string, string> {
  const salida: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    /*
     * El servidor exige probar que la mutacion nacio en nuestra interfaz
     * (`csrf-origin.middleware`). La peticion lleva las cookies del WebView
     * —en Android el `fetch` nativo comparte el tarro de galletas—, asi que no
     * entra por la puerta de "cliente nativo sin cookies" y sin este Origin
     * responde 403. Mismo criterio que `geo/traza-fondo.ts`.
     */
    salida.Origin = new URL(base).origin;
  } catch {
    // Una base sin forma de URL no tiene origen que declarar; el POST fallara
    // con 403 y el veredicto lo descarta sin reintentar.
  }
  return salida;
}

export function obtenerDeviceModel(): string {
  if (PlatformActual.OS === 'android') {
    const c = PlatformActual.constants as { Model?: string; Brand?: string; Manufacturer?: string };
    const modelo = (c?.Model || c?.Brand || 'Android Device').trim();
    return recortar(modelo, 64);
  }
  return recortar(PlatformActual.OS || 'Unknown Device', 64);
}

export function obtenerAndroidVersion(): string {
  if (PlatformActual.OS === 'android') {
    const v = PlatformActual.Version ? String(PlatformActual.Version).trim() : 'Android';
    return recortar(v, 32);
  }
  return 'Unknown';
}

function datosDelTelefono() {
  return {
    appVersion: recortar(mobilePackage.version || '0.1.0', 32),
    deviceModel: obtenerDeviceModel(),
    androidVersion: obtenerAndroidVersion(),
    bridgeProtocolVersion: PROTOCOLO_MAJOR,
  };
}

export function formatearErrorParaReporte(
  error: unknown,
  opciones: { fatal?: boolean; stackManual?: string } = {},
): ReportCrashPayload {
  let errorName = 'Error';
  let errorMessage = 'Error desconocido';
  let stack: string | undefined = opciones.stackManual;

  if (error instanceof Error) {
    errorName = error.name || 'Error';
    errorMessage = error.message || 'Error desconocido';
    if (!stack && error.stack) {
      stack = error.stack;
    }
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object') {
    errorMessage = JSON.stringify(error);
  }

  const sanitizedName = recortar(sanitizarTexto(errorName) || 'Error', 120);
  const sanitizedMessage = recortar(sanitizarTexto(errorMessage) || 'Error sin descripción', 4_000);
  const sanitizedStack = stack ? recortar(sanitizarTexto(stack), 40_000) : undefined;

  return {
    errorName: sanitizedName,
    errorMessage: sanitizedMessage,
    ...(sanitizedStack ? { stack: sanitizedStack } : {}),
    ...datosDelTelefono(),
    fatal: opciones.fatal ?? false,
    occurredAt: new Date().toISOString(),
  };
}

export type Veredicto = 'entregado' | 'reintentar' | 'descartar';

/**
 * Que hacer con el reporte segun lo que contesto el servidor.
 *
 * Reintentar de mas le cuesta bateria y datos al guardia; reintentar de menos
 * pierde justo la caida del subterraneo, que es la que nadie vio. La linea
 * esta en si la respuesta puede cambiar mas tarde:
 *
 * - 401: todavia no hay sesion —el arranque reporta la caida de ayer antes de
 *   que el guardia entre—. Despues del login vale, asi que espera.
 * - 429: el techo por usuario/hora del servidor. Vuelve a valer solo.
 * - 5xx y fallo de red: el servidor o la señal, nunca el reporte.
 * - 400: el cuerpo no cumple el contrato y no lo va a cumplir nunca.
 * - 403 y 404: el modulo esta apagado para la empresa o el origen no pasa el
 *   CSRF. Se descarta Y se deja de intentar hasta el proximo arranque: sin eso
 *   el telefono golpea un 404 por cada caida y por cada vuelta a primer plano.
 */
export function veredictoDeRespuesta(status: number): Veredicto {
  if (status >= 200 && status < 300) return 'entregado';
  if (status === 401 || status === 408 || status === 429 || status >= 500) return 'reintentar';
  return 'descartar';
}

async function entregar(payload: ReportCrashPayload, base: string): Promise<Veredicto> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 5_000);
  try {
    const respuesta = await fetch(endpointDeCaidas(base), {
      method: 'POST',
      headers: cabeceras(base),
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: controlador.signal,
    });
    const veredicto = veredictoDeRespuesta(respuesta.status);
    if (veredicto === 'descartar' && (respuesta.status === 403 || respuesta.status === 404)) {
      apagadoHastaElProximoArranque = true;
    }
    return veredicto;
  } catch {
    return 'reintentar';
  } finally {
    clearTimeout(temporizador);
  }
}

export async function encolarCaidaOffline(payload: ReportCrashPayload): Promise<void> {
  await encolarCaida(payload as unknown as Record<string, unknown>);
}

export async function vaciarColaDeCaidas(apiUrl?: string): Promise<void> {
  const base = apiUrl || apiUrlActual;
  if (!base || enviandoCaida || apagadoHastaElProximoArranque) return;

  enviandoCaida = true;
  try {
    const pendientes = await leerCaidas();
    if (pendientes.length === 0) return;

    const aBorrar: number[] = [];
    const ahora = Date.now();

    for (const caida of pendientes) {
      const guardada = Date.parse(caida.queuedAt);
      if (Number.isFinite(guardada) && ahora - guardada > VIGENCIA_DE_UNA_CAIDA_MS) {
        aBorrar.push(caida.sequence);
        continue;
      }
      const veredicto = await entregar(caida.payload as unknown as ReportCrashPayload, base);
      if (veredicto === 'entregado' || veredicto === 'descartar') {
        aBorrar.push(caida.sequence);
      }
      if (apagadoHastaElProximoArranque) break;
    }

    await borrarCaidas(aBorrar);
  } catch {
    // Silencioso: vaciar la cola no puede ser motivo de una caida nueva.
  } finally {
    enviandoCaida = false;
  }
}

async function despachar(payload: ReportCrashPayload, apiUrl?: string): Promise<void> {
  const base = apiUrl || apiUrlActual;
  if (!base || apagadoHastaElProximoArranque) {
    await encolarCaida(payload as unknown as Record<string, unknown>);
    return;
  }

  const veredicto = await entregar(payload, base);
  if (veredicto === 'reintentar') {
    await encolarCaida(payload as unknown as Record<string, unknown>);
  }
}

export async function reportarCaida(
  error: unknown,
  opciones: { fatal?: boolean; stackManual?: string; apiUrl?: string } = {},
): Promise<void> {
  // Si el reportador se cae reportando, no vuelve a entrar.
  if (enviandoCaida) return;

  const payload = formatearErrorParaReporte(error, opciones);
  enviandoCaida = true;
  try {
    await despachar(payload, opciones.apiUrl);
  } catch {
    // Ni un error aca puede escaparse: estamos manejando una caida.
  } finally {
    enviandoCaida = false;
  }
}

/**
 * La caida que mata el proceso entero.
 *
 * No deja mandar nada en el momento —no hay proceso—, asi que se deduce en el
 * arranque siguiente: si la corrida anterior nunca escribio "cerre bien" al
 * pasar a segundo plano, murio de pie.
 *
 * Se arma el reporte a mano y se despacha TAL CUAL. Pasarlo por
 * `reportarCaida()` lo trataba como un error cualquiera: el objeto entero
 * terminaba serializado dentro de `errorMessage` y el nombre volvia a ser
 * 'Error', asi que en el panel la caida nativa se veia como un JSON pegado y
 * no como lo que es.
 */
export async function registrarArranqueYVerificarCierre(apiUrl?: string): Promise<void> {
  try {
    const ultimoEstado = await storageActivo.getItemAsync(STORAGE_CLEAN_EXIT);
    if (ultimoEstado === 'false') {
      await despachar(
        {
          errorName: 'NativeCrash',
          errorMessage: 'La aplicación terminó de forma inesperada en la ejecución anterior',
          ...datosDelTelefono(),
          fatal: true,
          occurredAt: new Date().toISOString(),
        },
        apiUrl,
      );
    }

    await storageActivo.setItemAsync(STORAGE_CLEAN_EXIT, 'false');

    AppStateActual.addEventListener('change', (proximoEstado: string) => {
      if (proximoEstado === 'background' || proximoEstado === 'inactive') {
        void storageActivo.setItemAsync(STORAGE_CLEAN_EXIT, 'true');
      } else if (proximoEstado === 'active') {
        void storageActivo.setItemAsync(STORAGE_CLEAN_EXIT, 'false');
        /*
         * Volver a primer plano es la señal barata de "quiza ya hay señal": la
         * caida ocurrida en el subterraneo sale cuando el guardia saca el
         * telefono, sin esperar al proximo arranque de la app.
         */
        void vaciarColaDeCaidas(apiUrl).catch(() => undefined);
      }
    });

    void vaciarColaDeCaidas(apiUrl);
  } catch {
    // Silencioso
  }
}

export function instalarReportadorGlobal(obtenerApi: () => string | null): void {
  const globalAny = global as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    };
  };

  if (!globalAny.ErrorUtils?.setGlobalHandler) return;

  const handlerPrevio = globalAny.ErrorUtils.getGlobalHandler?.();

  globalAny.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    const url = obtenerApi();

    if (isFatal) {
      // Un fatal termina el proceso apenas vuelve este handler (es lo que hace
      // el handlerPrevio de React Native): un `fetch` async no alcanza a
      // completarse, y el `catch` de reportarCaida() que encolaria offline
      // tampoco corre. Por eso primero se ENCOLA -una escritura que el proceso
      // si alcanza a esperar- y recien despues se cede el proceso. El intento
      // de envio inmediato es beneficio extra, no la garantia: si el proceso
      // muere antes, la cola sale en el proximo arranque.
      const payload = formatearErrorParaReporte(error, { fatal: true });
      encolarCaida(payload as unknown as Record<string, unknown>)
        .then(() => vaciarColaDeCaidas(url ?? undefined))
        .catch(() => undefined)
        .finally(() => {
          if (handlerPrevio) handlerPrevio(error, isFatal);
        });
      return;
    }

    void reportarCaida(error, { fatal: isFatal ?? false, apiUrl: url ?? undefined });

    if (handlerPrevio) {
      handlerPrevio(error, isFatal);
    }
  });
}
