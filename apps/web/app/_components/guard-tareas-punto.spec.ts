import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TareaPuntoFormulario } from './guard-tareas-punto';
import { cantidadesDeFotos, puntoConTareasParaRetomar, estadoTareasInicial, vistaConEvidenciaPendiente, type ItemTarea } from './guard-tareas-modelo';

const tarea: ItemTarea = { id: 'tarea', position: 1, label: '¿Está cerrada la cortina?',
  responseType: 'si_no', requiresPhoto: true, requiresPhotoOnFail: false, photoMinCount: 2, photoMaxCount: 3 };
function formulario(item: ItemTarea, cantidad: number, value = '') {
  return renderToStaticMarkup(createElement(TareaPuntoFormulario, {
    item, borrador: { value, clientScanId: 'scan', fotos: Array.from({ length: cantidad },
      (_, i) => ({ clientPhotoId: `foto-${i}` })) }, ocupada: false,
    onFoto: () => undefined, onTexto: () => undefined, onResponder: () => undefined,
  }));
}
describe('tareas: foto antes de la pregunta y envío sin confirmación extra', () => {
  it.each([
    { plantillaLista: false, fotoPendiente: false, tareasPendientes: false },
    { plantillaLista: true, fotoPendiente: true, tareasPendientes: false },
    { plantillaLista: true, fotoPendiente: false, tareasPendientes: true },
  ])('el resumen del último NFC no tapa el trabajo pendiente: %j', (trabajo) => {
    expect(vistaConEvidenciaPendiente('resumen', trabajo)).toBe('ronda');
  });
  it('presenta el término de ronda una vez completas las fotos y respuestas', () => {
    expect(vistaConEvidenciaPendiente('resumen', {
      plantillaLista: true, fotoPendiente: false, tareasPendientes: false,
    })).toBe('resumen');
  });
  it('pide la primera foto antes de ofrecer la respuesta binaria', () => {
    const html = formulario(tarea, 0);
    expect(html).toContain('Tomar foto');
    expect(html).not.toContain('>SÍ</button>');
    expect(html).not.toContain('Guardar tarea');
  });
  it('al volver de cámara ofrece Agregar foto hasta cumplir el mínimo', () => {
    const html = formulario(tarea, 1);
    expect(html).toContain('Agregar foto');
    expect(html).toContain('1 de 2 fotos mínimas');
    expect(html).not.toContain('>SÍ</button>');
  });
  it('habilita SÍ/NO al cumplir el mínimo, con espacio para otra foto', () => {
    const html = formulario(tarea, 2);
    expect(html).toContain('>SÍ</button>');
    expect(html).toContain('>NO</button>');
    expect(html).toContain('Agregar foto');
    expect(html).not.toContain('>Enviar</button>');
  });
  it('el máximo elimina el control para agregar una cuarta foto', () => {
    expect(formulario(tarea, 3)).not.toContain('Agregar foto');
  });
  it('argumento usa un único botón Enviar verde después de las fotos', () => {
    const html = formulario({ ...tarea, responseType: 'texto' }, 2, 'Portón cerrado');
    expect(html).toContain('<textarea');
    expect(html).toContain('guardia-boton-enviar');
    expect(html).toContain('>Enviar</button>');
    expect(html).not.toContain('Guardar tarea');
  });
  it('solo fotos no pide escribir ni confirmar una respuesta', () => {
    const html = formulario({ ...tarea, responseType: 'foto' }, 1);
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('>SÍ</button>');
    expect(html).not.toContain('>Enviar</button>');
  });
  it('el valor inicial es un mínimo de una foto y un máximo de tres', () => {
    expect(cantidadesDeFotos({ ...tarea, photoMinCount: null, photoMaxCount: null })).toEqual({ min: 1, max: 3 });
  });
  it('al reabrir retoma el último punto pendiente; no exige escanear de nuevo', () => {
    const item = { ...tarea, checkpointId: 'puerta' };
    const registro = { scannedAt: '2026-10-29T22:00:00Z', clientScanId: 'scan', scanId: 'servidor' };
    expect(puntoConTareasParaRetomar([item], estadoTareasInicial('ronda'), { puerta: registro }))
      .toEqual({ checkpointId: 'puerta', ...registro });
    expect(puntoConTareasParaRetomar([item], { ...estadoTareasInicial('ronda'), enviadas: [item.id] }, { puerta: registro })).toBeUndefined();
    expect(puntoConTareasParaRetomar([item], estadoTareasInicial('ronda'), {})).toBeUndefined();
  });
});
