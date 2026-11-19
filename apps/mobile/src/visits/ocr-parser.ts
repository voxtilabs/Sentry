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
  // ML Kit can transcribe the printed dividers or split the plate into lines.
  const separator = '[ .·•∙⋅●✦✧✱✿✪*|:\\-]*';
  const format = (shape: string) => Array.from(shape, char => char === 'L' ? '[A-Z]' : '[0-9]').join(separator);
  const patterns = ['LLLLDD', 'LLDDDD', 'LLLDDD', 'LLLDD'].map(format).join('|');
  const complete = new RegExp(`^(?:${patterns})$`);
  const misreadBadge = new RegExp(`^(${format('LLLL')})${separator}[OQ0]${separator}(${format('DD')})$`);
  const plates = new Set<string>();
  const normalized = lines.slice(0, 64).map(line => line.slice(0, 256).normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
  const append = (value: string) => {
    const plate = value.replace(/[^A-Z0-9]/g, '');
    // A day next to a month abbreviation (for example NOV 12) can otherwise
    // masquerade as an older motorcycle plate in text from another object.
    if (/^(?:JAN|ENE|FEB|MAR|APR|ABR|MAY|JUN|JUL|AUG|AGO|SEP|OCT|NOV|DEC|DIC)(?:0[1-9]|[12][0-9]|3[01])$/.test(plate)) return;
    plates.add(plate);
  };
  function appendComplete(value: string) {
    if (complete.test(value)) {
      append(value);
      return true;
    }
    // The emblem can be transcribed as an extra O, Q or 0. Accept it only
    // between all four letters and the complete pair of digits.
    const badge = misreadBadge.exec(value);
    if (!badge) return false;
    append(`${badge[1]}${badge[2]}`);
    return true;
  }
  for (const line of normalized) {
    if (appendComplete(line)) continue;
    const candidates = new RegExp(`(?:^|[^A-Z0-9])(${patterns})(?=$|[^A-Z0-9])`, 'g');
    for (const match of line.matchAll(candidates)) {
      if (match[1]) append(match[1]);
    }
  }
  for (let start = 0; start < normalized.length; start++) {
    const fragments = normalized.slice(start, start + 3);
    for (let length = 2; length <= fragments.length; length++) {
      const candidate = fragments.slice(0, length).join(' ');
      appendComplete(candidate);
    }
  }
  return { kind:'plate',plates:[...plates].sort((a,b)=>b.length-a.length).slice(0,8) };
}
