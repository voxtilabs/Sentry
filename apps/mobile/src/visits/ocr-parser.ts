import type { ResultadoOcrPayload } from '../bridge/protocol';

/** Allowlist: nunca devolver texto completo, serie, fechas, MRZ, foto o firma. */
export function extraerIdentidad(lines: readonly string[]): ResultadoOcrPayload {
  const normal = lines.map(line => line.trim().toUpperCase());
  const clean = (value: string) => value.replace(/[^A-ZÁÉÍÓÚÜÑ '\-]/g,'').trim().slice(0,120);
  const field = (label: RegExp) => {
    const index = normal.findIndex(line => label.test(line));
    if (index < 0) return undefined;
    const sameLine = normal[index]!.replace(label,'').replace(/^[:\s]+/,'');
    if (sameLine && /^[A-ZÁÉÍÓÚÜÑ '\-]+$/.test(sameLine)) return clean(sameLine);
    const values: string[] = [];
    for (let i=index+1;i<Math.min(index+3,normal.length);i++) {
      const line = normal[i]!;
      if (/NOMBRES|APELLIDOS|NACIONALIDAD|SEXO|FECHA|DOCUMENTO|RUN|RUT|FIRMA|IDENTIDAD|CHILE/.test(line) || !/^[A-ZÁÉÍÓÚÜÑ '\-]+$/.test(line)) break;
      values.push(line);
    }
    return clean(values.join(' ')) || undefined;
  };
  // Exige el guion y dígito verificador: un número de documento no es un RUN.
  const run = normal.join('\n').match(/\b\d{1,2}\.\d{3}\.\d{3}\s*-\s*[0-9K]\b|\b\d{6,8}\s*-\s*[0-9K]\b/)?.[0]?.replace(/[.\s]/g,'');
  const givenNames = field(/^NOMBRES?\b/);
  const familyNames = field(/^APELLIDOS?\b/);
  return { kind:'identity',...(run ? {run} : {}),...(givenNames ? {givenNames} : {}),...(familyNames ? {familyNames} : {}) };
}

export function extraerPatentes(lines: readonly string[]): ResultadoOcrPayload {
  const plates = new Set<string>();
  for (const line of lines) {
    for (const value of line.toUpperCase().matchAll(/\b(?:[A-Z]{4}[ .-]?\d{2}|[A-Z]{2}[ .-]?\d{4}|[A-Z]{3}[ .-]?\d{2,3})\b/g)) {
      plates.add(value[0].replace(/[ .-]/g,''));
    }
  }
  return { kind:'plate',plates:[...plates].slice(0,8) };
}
