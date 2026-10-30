'use client';

import { useEffect, useState } from 'react';

import type { ResultadoPermisoPayload } from '../_lib/bridge/protocol';

export type PedirPermisoCamara = (
  permiso: 'camara', divulgacionMostrada: boolean,
) => Promise<ResultadoPermisoPayload>;

/** Android's file capture intent needs CAMERA granted before the user taps it. */
export function GuardCameraInput({ id, onFoto, pedirPermiso, disabled = false, etiqueta = 'Tomar foto' }: {
  id: string;
  onFoto: (foto: File) => void;
  pedirPermiso?: PedirPermisoCamara;
  disabled?: boolean;
  etiqueta?: string;
}) {
  const [permiso, setPermiso] = useState<'esperando' | 'concedido' | 'denegado'>(
    pedirPermiso ? 'esperando' : 'concedido',
  );
  useEffect(() => {
    if (!pedirPermiso) return;
    let vigente = true;
    void pedirPermiso('camara', true)
      .then((resultado) => {
        if (vigente) setPermiso(resultado.estado === 'concedido' ? 'concedido' : 'denegado');
      })
      .catch(() => { if (vigente) setPermiso('denegado'); });
    return () => { vigente = false; };
  }, [pedirPermiso]);

  return <div className="guardia-foto">
    {permiso === 'concedido' ? <>
      <label className="guardia-boton-secundario ancho" htmlFor={id}>{etiqueta}</label>
      <input id={id} type="file" accept="image/*" capture="environment"
        className="guardia-invisible" disabled={disabled}
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          if (archivo) onFoto(archivo);
          evento.target.value = '';
        }} />
    </> : <><p role="status" className="guardia-nota">
      {permiso === 'esperando' ? 'Preparando la cámara…' :
        'Activa Cámara en Ajustes → Aplicaciones → SentryCore → Permisos y vuelve a esta pantalla.'}
    </p>{permiso === 'denegado' && pedirPermiso ? <button className="guardia-boton-secundario ancho"
      type="button" onClick={() => {
        setPermiso('esperando');
        void pedirPermiso('camara', true).then((result) => {
          setPermiso(result.estado === 'concedido' ? 'concedido' : 'denegado');
        }).catch(() => setPermiso('denegado'));
      }}>Revisar permiso de cámara</button> : null}</>}
  </div>;
}
