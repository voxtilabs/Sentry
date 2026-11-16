import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fotoParaPdf, presupuestoFotoPdf } from './pdf-photo';

it('reduce la copia del PDF sin alterar la imagen original ni su huella', async () => {
  const pixeles = Buffer.alloc(2000 * 1600 * 3);
  for (let i = 0; i < pixeles.length; i++) pixeles[i] = (i * 37 + Math.floor(i / 6000)) % 256;
  const original = await sharp(pixeles, { raw: { width: 2000, height: 1600, channels: 3 } })
    .png({ compressionLevel: 0 }).toBuffer();
  const huella = createHash('sha256').update(original).digest('hex');
  const copia = await fotoParaPdf(original);
  const meta = await sharp(copia).metadata();
  expect(meta).toMatchObject({ format: 'jpeg', width: 1280, height: 1024 });
  expect(copia.length).toBeLessThan(original.length / 5);
  expect(createHash('sha256').update(original).digest('hex')).toBe(huella);
});

it('conserva una imagen que ya pesa pocos kilobytes', async () => {
  const original = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#456789' } }).jpeg().toBuffer();
  expect(await fotoParaPdf(original)).toBe(original);
});

it('un archivo ilegible no interrumpe la generación tolerante del informe', async () => {
  const original = Buffer.alloc(250_000, 0x25);
  expect(await fotoParaPdf(original)).toBe(original);
});

it('ajusta imágenes que el umbral antiguo de 200 KB dejaba pasar para rondas con muchas fotos', async () => {
  const pixeles = Buffer.alloc(640 * 480 * 3);
  let seed = 42;
  for (let i = 0; i < pixeles.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixeles[i] = seed >>> 24;
  }
  const original = await sharp(pixeles, { raw: { width: 640, height: 480, channels: 3 } })
    .jpeg({ quality: 60 }).toBuffer();
  expect(original.length).toBeLessThan(200 * 1024);
  const presupuesto = presupuestoFotoPdf(8 * 1024 * 1024, 96);
  const copia = await fotoParaPdf(original, presupuesto);
  expect(copia.length).toBeLessThan(original.length * 0.9);
  expect((await sharp(copia).metadata()).width).toBeGreaterThanOrEqual(640);
  expect(presupuesto * 96).toBeLessThan(8 * 1024 * 1024 * 0.7);
});
