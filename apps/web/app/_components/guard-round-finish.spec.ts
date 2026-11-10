import { pedirApi, sincronizar } from './guard-outbox';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import { cargarEstadoTareas, modificarEstadoTareas } from './guard-tareas-modelo';
jest.mock('./guard-outbox', () => ({ pedirApi: jest.fn(), sincronizar: jest.fn() }));
jest.mock('./guard-tareas-flujo', () => ({ sincronizarTareasGuardadas: jest.fn() }));
jest.mock('./guard-tareas-modelo', () => ({ cargarEstadoTareas: jest.fn(), modificarEstadoTareas: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(pedirApi).mockResolvedValue(new Response('{}', { status: 503 })); jest.mocked(cargarEstadoTareas).mockReturnValue({ patrolId: 'ronda', cola: [], enviadas: [] }); });
import { confirmarTerminoDeRonda } from './guard-round-finish';

describe('término de ronda después de trabajar sin conexión',()=>{
  it('confirma una sola vez y vuelve al documento del inicio manteniendo la sesión',async()=>{
    const order:string[]=[],navegar=jest.fn((path:string)=>{order.push(path)});
    const pedir=jest.fn(async()=>{order.push('confirmado');return new Response('{}',{status:200})});
    await confirmarTerminoDeRonda('/api','ronda',navegar,pedir);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith('/api','/guard/patrols/ronda/confirm-flow',{method:'POST'});
    expect(modificarEstadoTareas).toHaveBeenCalled();
    expect(sincronizar).toHaveBeenCalledWith('/api');
    expect(sincronizarTareasGuardadas).toHaveBeenCalled();
    expect(order).toEqual(['confirmado','/app/guardia']);
  });
  it('no confirma el cierre ni navega mientras quede una foto sin acuse', async () => {
    jest.mocked(cargarEstadoTareas).mockReturnValue({ patrolId: 'ronda', cola: [], enviadas: [],
      borradores: { tarea: { value: '', clientScanId: 'scan', fotos: [{ clientPhotoId: 'foto' }] } } });
    const pedir = jest.fn(), navegar = jest.fn();
    await expect(confirmarTerminoDeRonda('/api', 'ronda', navegar, pedir)).rejects.toThrow('siguen guardadas');
    expect(pedir).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });
  it('conserva el formulario si faltan tareas o falla la conexión',async()=>{
    const navegar=jest.fn();
    await expect(confirmarTerminoDeRonda('/api','ronda',navegar,async()=>new Response('{"message":"Faltan tareas"}',{status:409}))).rejects.toThrow('Faltan tareas');
    await expect(confirmarTerminoDeRonda('/api','ronda',navegar,async()=>{throw new Error('Sin red')})).rejects.toThrow('Sin red');
    expect(navegar).not.toHaveBeenCalled();
  });
});
