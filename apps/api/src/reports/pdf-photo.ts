import sharp from 'sharp';

// Copia para impresión en A4. El archivo original y su huella no se modifican.
const LADO_MAXIMO_PX = 1280;
const UMBRAL_OPTIMIZACION_BYTES = 200 * 1024;
const CALIDAD_JPEG = 85;

/** Optimiza una foto por vez; conserva la entrada si ya es pequeña o no mejora. */
export async function fotoParaPdf(original: Buffer): Promise<Buffer> {
  if (original.length <= UMBRAL_OPTIMIZACION_BYTES) return original;
  try {
    const reducida = await sharp(original, { limitInputPixels: 40_000_000, sequentialRead: true })
      .rotate()
      .resize({ width: LADO_MAXIMO_PX, height: LADO_MAXIMO_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
    return reducida.length < original.length ? reducida : original;
  } catch {
    // El renderer conserva su tratamiento de evidencia ilegible o no disponible.
    return original;
  }
}
