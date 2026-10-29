'use client';

import { useRef, useState } from 'react';
import { GuardCameraInput, type PedirPermisoCamara } from './guard-camera-input';
import { procesarFoto } from './guard-photo';
import { guardarFoto } from './guard-photo-store';
import { nuevoUuid } from './guard-storage';
import { sincronizarTareasGuardadas } from './guard-tareas-flujo';
import {
  cargarEstadoTareas, cantidadesDeFotos, responderTarea, tareaExigeFoto,
  tareasDelPuntoPorResponder, type BorradorTarea, type EstadoTareas, type ItemTarea,
} from './guard-tareas-modelo';

/** Una tarea a la vez: cámara → pregunta → envío, sin confirmaciones duplicadas. */
export function GuardTareasPunto({ apiUrl, nombrePunto, checkpointId, clientScanId, scanId,
  items, estado, foto, idDelEscaneo, onEstado, onListo, pedirPermisoCamara,
}: {
  apiUrl: string; nombrePunto: string; checkpointId: string; clientScanId: string; scanId?: string;
  items: readonly ItemTarea[]; estado: EstadoTareas;
  foto: { sitio: string; ruta: string; zonaHoraria?: string; objetivoBytes?: number };
  idDelEscaneo: () => string | undefined;
  onEstado: (estado: EstadoTareas) => void; onListo: () => void;
  pedirPermisoCamara?: PedirPermisoCamara;
}) {
  const [ocupada, setOcupada] = useState(false);
  const candado = useRef(false);
  const [aviso, setAviso] = useState<string>();
  const pendientes = tareasDelPuntoPorResponder(items, estado, checkpointId);
  const item = pendientes[0];
  if (!item) return null;
  const borrador = estado.borradores?.[item.id] ?? { value: '', clientScanId, fotos: [] };

  function anotar(tarea: ItemTarea, cambio: Partial<BorradorTarea>) {
    const actual = cargarEstadoTareas(estado.patrolId);
    const previo = actual.borradores?.[tarea.id] ?? { value: '', clientScanId, fotos: [] };
    const siguiente = { ...actual, borradores: { ...actual.borradores,
      [tarea.id]: { ...previo, ...cambio } } };
    onEstado(siguiente);
    return siguiente;
  }

  function registros() {
    const id = scanId ?? idDelEscaneo();
    return { [checkpointId]: { clientScanId, ...(id ? { scanId: id } : {}) } };
  }

  async function completar(tarea: ItemTarea, value: string) {
    const actual = cargarEstadoTareas(estado.patrolId);
    const fotos = actual.borradores?.[tarea.id]?.fotos ?? [];
    if (!value.trim() || (tareaExigeFoto(tarea, value) && fotos.length < cantidadesDeFotos(tarea).min)) return;
    onEstado(responderTarea(actual, { item: tarea, value,
      respondidaAt: new Date().toISOString(), clientScanId, fotos }));
    await sincronizarTareasGuardadas(apiUrl, estado.patrolId, registros());
  }

  async function responder(tarea: ItemTarea, value: string) {
    if (candado.current) return;
    candado.current = true;
    setOcupada(true);
    try {
      anotar(tarea, { value });
      await completar(tarea, value);
    } finally {
      candado.current = false;
      setOcupada(false);
    }
  }

  async function capturar(tarea: ItemTarea, archivo: File) {
    if (candado.current) return;
    const actual = cargarEstadoTareas(estado.patrolId);
    const previas = actual.borradores?.[tarea.id]?.fotos ?? [];
    if (previas.length >= cantidadesDeFotos(tarea).max) return;
    candado.current = true;
    setOcupada(true);
    setAviso(undefined);
    try {
      const clientPhotoId = nuevoUuid();
      const tomadaAt = new Date().toISOString();
      const imagen = await procesarFoto(archivo, { sitio: foto.sitio, ruta: foto.ruta,
        ...(foto.zonaHoraria ? { zonaHoraria: foto.zonaHoraria } : {}),
        ...(foto.objetivoBytes ? { objetivoBytes: foto.objetivoBytes } : {}) });
      await guardarFoto(clientPhotoId, imagen, tomadaAt, scanId ?? idDelEscaneo() ?? null, 'tarea');
      const siguiente = anotar(tarea, { fotos: [...previas, { clientPhotoId }] });
      const value = tarea.responseType === 'foto' ? 'foto' : siguiente.borradores?.[tarea.id]?.value ?? '';
      if (tarea.responseType === 'foto' || ((tarea.responseType === 'ok_falla' || tarea.responseType === 'si_no') && value)) {
        await completar(tarea, value);
      }
      await sincronizarTareasGuardadas(apiUrl, estado.patrolId, registros());
      const guardado = cargarEstadoTareas(estado.patrolId);
      const pendiente = guardado.borradores?.[tarea.id]?.fotos.some((f) => !f.photoId) ||
        guardado.cola.some((r) => r.itemId === tarea.id);
      setAviso(pendiente ? 'Foto guardada en el teléfono. Se enviará automáticamente al recuperar conexión.' : 'Foto enviada.');
    } catch {
      setAviso('No pudimos guardar la foto. Vuelve a tomarla antes de continuar.');
    } finally {
      candado.current = false;
      setOcupada(false);
    }
  }

  return <section className="guardia-tareas-punto" aria-labelledby="guardia-tareas-titulo">
    <h2 id="guardia-tareas-titulo">Tareas de {nombrePunto}</h2>
    <p className="guardia-nota">{pendientes.length} {pendientes.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}. Las fotos se envían al tomarlas.</p>
    <TareaPuntoFormulario item={item} borrador={borrador} ocupada={ocupada}
      onFoto={(archivo) => void capturar(item, archivo)}
      onTexto={(value) => anotar(item, { value })}
      onResponder={(value) => void responder(item, value)}
      {...(pedirPermisoCamara ? { pedirPermisoCamara } : {})} />
    {aviso ? <p className="guardia-anuncio" role="status">{aviso}</p> : null}
    <button className="guardia-boton-texto" disabled={ocupada} onClick={onListo} type="button">Seguir con la ronda</button>
    <p className="guardia-nota">Las tareas que dejes pendientes aparecerán en el informe.</p>
  </section>;
}

/** El formulario permite comprobar el orden de los controles sin simular la red. */
export function TareaPuntoFormulario({ item, borrador, ocupada, onFoto, onTexto, onResponder, pedirPermisoCamara }: {
  item: ItemTarea; borrador: BorradorTarea; ocupada: boolean;
  onFoto: (archivo: File) => void; onTexto: (value: string) => void; onResponder: (value: string) => void;
  pedirPermisoCamara?: PedirPermisoCamara;
}) {
  const { min, max } = cantidadesDeFotos(item);
  const exigeFoto = tareaExigeFoto(item, borrador.value);
  const lista = !exigeFoto || borrador.fotos.length >= min;
  const binaria = item.responseType === 'ok_falla' || item.responseType === 'si_no';
  const campo = `tarea-${item.id}`;
  return <div className="guardia-tarea" aria-busy={ocupada}>
    <p className="guardia-tarea-label" id={campo}>{item.label}</p>
    {item.dueLocalTime ? <p className="guardia-nota">Hora de referencia: {item.dueLocalTime.slice(0, 5)}</p> : null}
    {exigeFoto ? <div className="guardia-tarea-fotos">
      <p className="guardia-nota" role="status">{borrador.fotos.length} de {min} fotos mínimas · máximo {max}</p>
      {borrador.fotos.length < max ? <GuardCameraInput id={`${campo}-foto`} disabled={ocupada}
        etiqueta={borrador.fotos.length ? 'Agregar foto' : 'Tomar foto'} onFoto={onFoto}
        {...(pedirPermisoCamara ? { pedirPermiso: pedirPermisoCamara } : {})} /> : null}
      {!lista ? <p className="guardia-nota">Primero toma {min - borrador.fotos.length} {min - borrador.fotos.length === 1 ? 'foto más' : 'fotos más'}.</p> : null}
    </div> : null}
    {lista && item.responseType !== 'foto' ? <>
      {binaria ? <div className="guardia-ok-falla" role="group" aria-labelledby={campo}>
        <button className="guardia-boton-opcion" disabled={ocupada} type="button"
          onClick={() => onResponder(item.responseType === 'ok_falla' ? 'ok' : 'si')}>SÍ</button>
        <button className="guardia-boton-opcion" disabled={ocupada} type="button"
          onClick={() => onResponder(item.responseType === 'ok_falla' ? 'falla' : 'no')}>NO</button>
      </div> : <>
        {item.responseType === 'numero' ? <input className="guardia-entrada" aria-labelledby={campo} inputMode="decimal"
          maxLength={500} value={borrador.value} onChange={(e) => onTexto(e.target.value)} />
          : <textarea className="guardia-texto" aria-labelledby={campo} placeholder="Escribe tu respuesta"
            maxLength={500} rows={3} value={borrador.value} onChange={(e) => onTexto(e.target.value)} />}
        <button className="guardia-boton-enviar ancho" type="button" disabled={ocupada || !borrador.value.trim()}
          onClick={() => onResponder(borrador.value)}>{ocupada ? 'Enviando…' : 'Enviar'}</button>
      </>}
    </> : null}
    {ocupada ? <p className="guardia-nota" role="status">Guardando y enviando automáticamente…</p> : null}
  </div>;
}
