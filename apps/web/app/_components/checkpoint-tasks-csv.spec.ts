import { parseCheckpointTasksCsv } from './checkpoint-tasks-csv';

const points = [{ id: 'p1', name: 'Punto renombrado', tagUids: ['AABB1234'] }];
describe('tareas por punto desde CSV', () => {
  it('asocia por UID y conserva comillas, tildes y preguntas', () => {
    const result = parseCheckpointTasksCsv('\uFEFFrecinto,punto_nfc_nombre,id,tarea\r\nCasa,Original,AABB1234,"Fotografía puerta, completa"\r\nCasa,Original,AABB1234,Puerta cerrada? (SI/NO)', points);
    expect(result.errors).toEqual([]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toMatchObject({ checkpointId: 'p1', requiresPhoto: true, label: 'Fotografía puerta, completa' });
    expect(result.tasks[1]).toMatchObject({ responseType: 'si_no', requiresPhoto: false });
  });
  it('no agrega tareas de otros recintos ni duplica filas', () => {
    const result = parseCheckpointTasksCsv('id;tarea\nAABB1234;Fotografía puerta\nFFFF9999;Otra\nAABB1234;Fotografía puerta', points);
    expect(result.tasks).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
  it('rechaza UID ambiguo y archivos sin las columnas esperadas', () => {
    expect(parseCheckpointTasksCsv('id,tarea\nAABB1234,Revisar', [...points, { ...points[0]!, id: 'p2' }]).errors.length).toBe(1);
    expect(parseCheckpointTasksCsv('nombre,descripcion', points).errors.length).toBe(1);
  });
});
