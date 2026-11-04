/**
 * La cola de caidas que sobrevive al reinicio (#273).
 *
 * Vive en la MISMA base cifrada que los escaneos (`offline/route-store`) y no
 * en SecureStore. El tope por valor de SecureStore en Android es de 2 KB y una
 * pila de excepcion ronda las decenas de miles de caracteres: el reporte se
 * guardaba "bien" contra un mock y se perdia en el telefono, que es el unico
 * lugar donde importa. El servidor acepta hasta 40 KB de pila, asi que el
 * formato de almacenamiento tiene que aguantar eso.
 *
 * Si la base no abre —SQLCipher ausente, almacenamiento lleno— la cola cae a
 * memoria del proceso: se pierde al reiniciar, pero el reportador jamas tumba
 * la app por no poder guardar una caida. Perder el reporte es malo; perder la
 * ronda del guardia por el reporte es peor.
 */

export interface CaidaEnCola {
  readonly sequence: number;
  readonly payload: Record<string, unknown>;
  readonly queuedAt: string;
}

interface BaseMinima {
  runAsync: (sql: string, ...params: unknown[]) => Promise<unknown>;
  getAllAsync: <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
}

/** Tope de reportes guardados. Mas que esto no diagnostica mejor, solo ocupa. */
export const MAXIMO_EN_COLA = 20;

let memoria: CaidaEnCola[] = [];
let siguienteEnMemoria = 1;
let soloMemoria = false;

async function base(): Promise<BaseMinima | null> {
  if (soloMemoria) return null;
  try {
    // Carga perezosa a proposito: `route-store` importa modulos nativos de
    // Expo que no existen cuando estas pruebas corren en Node.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('../offline/route-store') as {
      abrirBaseOperativa: () => Promise<BaseMinima>;
    };
    return await store.abrirBaseOperativa();
  } catch {
    return null;
  }
}

/** Para las pruebas y para el telefono sin base: la cola vive en el proceso. */
export function usarColaEnMemoria(activar = true): void {
  soloMemoria = activar;
  memoria = [];
  siguienteEnMemoria = 1;
}

export async function encolarCaida(
  payload: Record<string, unknown>,
  queuedAt = new Date().toISOString(),
): Promise<void> {
  const db = await base();
  if (!db) {
    if (memoria.length >= MAXIMO_EN_COLA) memoria.shift();
    memoria.push({ sequence: siguienteEnMemoria++, payload, queuedAt });
    return;
  }
  try {
    await db.runAsync(
      'INSERT INTO crash_queue (payload_json, queued_at) VALUES (?, ?)',
      JSON.stringify(payload),
      queuedAt,
    );
    // Se recorta por el extremo VIEJO: la caida mas reciente es la que el
    // guardia acaba de sufrir y la que alguien va a preguntar manana.
    await db.runAsync(
      `DELETE FROM crash_queue WHERE sequence NOT IN (
         SELECT sequence FROM crash_queue ORDER BY sequence DESC LIMIT ?
       )`,
      MAXIMO_EN_COLA,
    );
  } catch {
    // Guardar una caida no puede provocar otra.
  }
}

export async function leerCaidas(): Promise<CaidaEnCola[]> {
  const db = await base();
  if (!db) return [...memoria];
  try {
    const filas = await db.getAllAsync<{
      sequence: number;
      payload_json: string;
      queued_at: string;
    }>('SELECT sequence, payload_json, queued_at FROM crash_queue ORDER BY sequence');
    const salida: CaidaEnCola[] = [];
    for (const fila of filas) {
      try {
        salida.push({
          sequence: fila.sequence,
          payload: JSON.parse(fila.payload_json) as Record<string, unknown>,
          queuedAt: fila.queued_at,
        });
      } catch {
        // Una fila ilegible se descarta al vaciar, no rompe la lectura.
        salida.push({ sequence: fila.sequence, payload: {}, queuedAt: fila.queued_at });
      }
    }
    return salida;
  } catch {
    return [];
  }
}

export async function borrarCaidas(sequences: readonly number[]): Promise<void> {
  if (sequences.length === 0) return;
  const db = await base();
  if (!db) {
    memoria = memoria.filter((c) => !sequences.includes(c.sequence));
    return;
  }
  try {
    const huecos = sequences.map(() => '?').join(', ');
    await db.runAsync(`DELETE FROM crash_queue WHERE sequence IN (${huecos})`, ...sequences);
  } catch {
    // Si no se puede borrar, el reporte se reintenta y el servidor lo agrupa
    // por huella: un duplicado es preferible a perder el dato.
  }
}
