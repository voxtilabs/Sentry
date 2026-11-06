import sharp from 'sharp';

// Copia para impresión en A4. El archivo original y su huella no se modifican.
const LADO_MAXIMO_PX = 1280;
const UMBRAL_OPTIMIZACION_BYTES = 200 * 1024;
const CALIDAD_JPEG = 85;

/** Optimiza una foto por vez; conserva la entrada si ya es pequeña o no mejora. */
export async function fotoParaPdf(original: Buffer, objetivoBytes?: number): Promise<Buffer> {
  const objetivo = objetivoBytes ?? UMBRAL_OPTIMIZACION_BYTES;
  if (original.length <= objetivo) return original;
  try {
    const imagen = sharp(original, { limitInputPixels: 40_000_000, sequentialRead: true })
      .rotate()
      .flatten({ background: '#ffffff' });
    // Ajustar a lo que ocupa la copia impresa, sin rasterizar texto ni recorrido.
    const perfiles = objetivoBytes === undefined ? [[LADO_MAXIMO_PX, CALIDAD_JPEG]] :
      [[1100, 76], [1000, 66], [900, 58], [800, 50], [640, 45]];
    let mejor = original;
    for (const [lado, calidad] of perfiles) {
      const reducida = await imagen.clone()
        .resize({ width: lado!, height: lado!, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: calidad!, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
      if (reducida.length < mejor.length) mejor = reducida;
      if (mejor.length <= objetivo) break;
    }
    return mejor;
  } catch {
    // El renderer conserva su tratamiento de evidencia ilegible o no disponible.
    return original;
  }
}

/** Reserva espacio para mapas, texto y estructura; ninguna foto se elimina. */
export function presupuestoFotoPdf(maxPdfBytes: number, fotos: number): number {
  return Math.max(16 * 1024, Math.min(110 * 1024,
    Math.floor(maxPdfBytes * 0.65 / Math.max(1, fotos))));
}
