/** Límite técnico: solapar la latencia sin saturar la red móvil ni la memoria. */
export async function conSubidasAcotadas<T, R>(items: readonly T[], enviar: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;
  let fallo: unknown;
  let huboFallo = false;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (siguiente < items.length) {
      const indice = siguiente++;
      try { resultados[indice] = await enviar(items[indice]!); }
      catch (error) { huboFallo = true; fallo ??= error; }
    }
  }));
  // Esperar a todas evita dejar escrituras en vuelo mientras comienza un reintento.
  if (huboFallo) throw fallo;
  return resultados;
}
