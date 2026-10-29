import { detectDelimiter, splitCsv } from './checkpoint-csv';
import { tareaVacia, type PuntoDelRecinto, type TareaBorrador } from './tareas-turno-modelo';

/** Match immutable NFC identifiers, so renamed points never move tasks elsewhere. */
export function parseCheckpointTasksCsv(source: string, checkpoints: readonly PuntoDelRecinto[]) {
  const clean = source.replace(/^\uFEFF/, '');
  const rows = splitCsv(clean, detectDelimiter(clean)).filter((row) => row.some((cell) => cell.trim()));
  const headers = rows.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const uidColumn = headers.findIndex((cell) => ['id', 'uid_nfc', 'taguid'].includes(cell));
  const taskColumn = headers.findIndex((cell) => ['tarea', 'task'].includes(cell));
  const tasks: TareaBorrador[] = [];
  const errors: string[] = [];
  let skipped = 0;
  if (uidColumn < 0 || taskColumn < 0) return { tasks, skipped, errors: ['El CSV necesita las columnas id (UID NFC) y tarea.'] };
  const seen = new Set<string>();
  for (const [index, cells] of rows.entries()) {
    const uid = (cells[uidColumn] ?? '').replace(/[^a-f0-9]/gi, '').toUpperCase();
    const matches = checkpoints.filter((point) => point.tagUids?.some((tag) => tag.toUpperCase() === uid));
    if (!matches.length) { skipped += 1; continue; }
    const label = cells[taskColumn]?.trim() ?? '';
    if (matches.length !== 1 || label.length < 2 || label.length > 200) {
      errors.push(`Fila ${index + 2}: punto ambiguo o tarea inválida.`);
      continue;
    }
    const checkpointId = matches[0]!.id;
    const key = JSON.stringify([checkpointId, label]);
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ ...tareaVacia(`csv-${index}`), checkpointId, label,
      responseType: /s[ií]\s*\/\s*no|[¿?]/i.test(label) ? 'si_no' :
        /fotograf[ií]a|fotografiar|fotograf[ií]e|\bfoto\b/i.test(label) ? 'foto' : 'si_no',
      requiresPhoto: /fotograf[ií]a|fotografiar|fotograf[ií]e|\bfoto\b/i.test(label) });
  }
  if (!tasks.length && !errors.length) errors.push('Ninguna etiqueta del CSV corresponde al recinto seleccionado.');
  if (tasks.length > 100) errors.push('La plantilla admite hasta 100 tareas.');
  return { tasks, errors, skipped };
}
