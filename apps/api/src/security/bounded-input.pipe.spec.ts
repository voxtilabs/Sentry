import { PayloadTooLargeException } from '@nestjs/common';
import { BoundedInputPipe } from './bounded-input.pipe';

const pipe = new BoundedInputPipe();
describe('trabajo acotado antes de validar el cuerpo HTTP', () => {
  it('acepta el lote de 100 respuestas con 10 fotos cada una sin transformar valores', () => {
    const value = { responses: Array.from({ length: 100 }, (_, i) => ({ itemId: String(i),
      value: 'si', photoIds: Array.from({ length: 10 }, (_, f) => `${i}-${f}`) })) };
    expect(pipe.transform(value, { type: 'body' })).toBe(value);
  });
  it('rechaza arrays maliciosos antes de generar un error por cada elemento', () => {
    expect(() => pipe.transform({ reportRecipients: Array(50_000).fill(0) }, { type: 'body' }))
      .toThrow(PayloadTooLargeException);
  });
  it('rechaza profundidad excesiva sin recursión en la pila', () => {
    let value: unknown = null;
    for (let i = 0; i < 100; i++) value = { nested: value };
    expect(() => pipe.transform(value, { type: 'body' })).toThrow(PayloadTooLargeException);
  });
});
