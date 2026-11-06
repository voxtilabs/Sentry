import { PayloadTooLargeException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

/** Límite técnico de trabajo ANTES de construir errores de validación por elemento.
 * Complementa el límite de bytes HTTP; no modifica los límites de negocio de los DTO. */
export class BoundedInputPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    const seen = new WeakSet<object>();
    let remaining = 20_000;
    while (pending.length) {
      const current = pending.pop()!;
      if (--remaining < 0 || current.depth > 32) throw new PayloadTooLargeException('Solicitud demasiado compleja');
      if (!current.value || typeof current.value !== 'object') continue;
      if (seen.has(current.value)) throw new PayloadTooLargeException('Solicitud demasiado compleja');
      seen.add(current.value);
      const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
      if (children.length + pending.length > remaining) throw new PayloadTooLargeException('Solicitud demasiado compleja');
      for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
    }
    return value;
  }
}
