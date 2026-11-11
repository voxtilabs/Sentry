import { pedirApi } from './guard-outbox';

export interface EscaneoRecuperado { clientScanId: string; scanId: string; checkpointId: string }
type Registro = { clientScanId: string; scanId?: string };

/** Conserva los UUID originales y reconoce solo el alias creado por la reconciliación. */
export function mapaEscaneosRecuperados(scans: readonly EscaneoRecuperado[]): Record<string, Registro> {
  const mapa: Record<string, Registro> = {};
  for (const scan of scans) {
    mapa[scan.clientScanId] = scan;
    if (scan.checkpointId) {
      const alias = `desde-servidor:${scan.checkpointId}`;
      // La API ordena cronológicamente: el alias representa el primer escaneo del punto.
      mapa[alias] ??= { ...scan, clientScanId: alias };
    }
  }
  return mapa;
}

/** La API comprueba que la ronda pertenece al guardia y a su empresa. */
export async function recuperarIdsParaEvidencia(apiUrl: string, patrolId: string,
  registros: Readonly<Record<string, Registro>>, necesarios: readonly string[]): Promise<Record<string, Registro>> {
  const locales = Object.fromEntries(Object.values(registros).map((r) => [r.clientScanId, r]));
  if (necesarios.every((id) => locales[id]?.scanId)) return locales;
  const response = await pedirApi(apiUrl, `/checklists/patrols/${encodeURIComponent(patrolId)}/template?includeScanIds=true`);
  if (!response.ok) throw new Error('Tus fotos y respuestas siguen guardadas. No pudimos recuperar los puntos de esta ronda; vuelve a intentarlo con tu sesión y conexión activas.');
  const body = await response.json() as { syncScans?: EscaneoRecuperado[] };
  const recuperados = mapaEscaneosRecuperados(body.syncScans ?? []);
  for (const [id, registro] of Object.entries(locales)) {
    if (registro.scanId || !recuperados[id]) recuperados[id] = registro;
  }
  return recuperados;
}
