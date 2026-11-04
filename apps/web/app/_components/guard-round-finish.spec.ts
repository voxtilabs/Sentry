import { confirmarTerminoDeRonda } from './guard-round-finish';

describe('término de ronda después de trabajar sin conexión',()=>{
  it('confirma una sola vez y vuelve al documento del inicio manteniendo la sesión',async()=>{
    const order:string[]=[],navegar=jest.fn((path:string)=>{order.push(path)});
    const pedir=jest.fn(async()=>{order.push('confirmado');return new Response('{}',{status:200})});
    await confirmarTerminoDeRonda('/api','ronda',navegar,pedir);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith('/api','/guard/patrols/ronda/confirm-flow',{method:'POST'});
    expect(order).toEqual(['confirmado','/app/guardia']);
  });
  it('conserva el formulario si faltan tareas o falla la conexión',async()=>{
    const navegar=jest.fn();
    await expect(confirmarTerminoDeRonda('/api','ronda',navegar,async()=>new Response('{"message":"Faltan tareas"}',{status:409}))).rejects.toThrow('Faltan tareas');
    await expect(confirmarTerminoDeRonda('/api','ronda',navegar,async()=>{throw new Error('Sin red')})).rejects.toThrow('Sin red');
    expect(navegar).not.toHaveBeenCalled();
  });
});
