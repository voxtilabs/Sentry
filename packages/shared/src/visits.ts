/** RUN civil, no número de serie/documento de la cédula. */
export function normalizarRun(value: string): string | null {
  const clean = value.toUpperCase().replace(/[.\s]/g, '');
  const match = /^(\d{6,8})-([0-9K])$/.exec(clean);
  if (!match || /^0+$/.test(match[1]!)) return null;
  let sum = 0;
  let factor = 2;
  for (const digit of [...match[1]!].reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - sum % 11;
  const verifier = result === 11 ? '0' : result === 10 ? 'K' : String(result);
  return verifier === match[2] ? `${Number(match[1])}-${verifier}` : null;
}

export function normalizarPatente(value: string): string | null {
  const plate = value.toUpperCase().replace(/[\s.-]/g, '');
  return /^(?:[A-Z]{4}\d{2}|[A-Z]{2}\d{4}|[A-Z]{3}\d{2,3})$/.test(plate) ? plate : null;
}
