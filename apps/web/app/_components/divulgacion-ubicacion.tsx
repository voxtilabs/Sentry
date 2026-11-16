'use client';

/**
 * La divulgacion destacada de ubicacion, DELANTE del dialogo de Android.
 *
 * Google Play rechazo la app el 02-10-2026 por "Inadequate Prominent
 * Disclosure": el revisor entro con una cuenta que ya tenia el consentimiento
 * aceptado y lo primero que vio fue el dialogo del sistema pidiendo ubicacion,
 * sin nada delante que explicara para que. El consentimiento aceptado semanas
 * antes, en otro telefono, NO es la divulgacion: la divulgacion tiene que estar
 * delante del dialogo cada vez que el dialogo va a aparecer.
 *
 * QUE EXIGE LA POLITICA, Y DONDE ESTA CADA COSA AQUI:
 *
 *  - Nombrar el dato. Dice "ubicacion", no "datos" ni "informacion del
 *    dispositivo". Esta en el titulo y en la primera linea.
 *  - Decir que se recoge EN SEGUNDO PLANO. La frase "incluso cuando la
 *    aplicacion esta cerrada o no la estas usando" es textual de la guia de
 *    Play; es la que faltaba y la que mas rechazos provoca.
 *  - Decir para que se usa. Acreditar el recorrido de la ronda y auxiliar en
 *    una emergencia.
 *  - Aparecer en el uso normal de la app, no en la politica de privacidad ni en
 *    los terminos. Por eso es una pantalla propia y no un enlace.
 *  - Exigir una accion afirmativa para continuar. "Continuar" abre el dialogo;
 *    "Ahora no" lo cierra sin pedir nada. Cerrar tocando fuera NO cuenta como
 *    aceptar, asi que no se puede.
 *
 * Lo que NO hace: bloquear el trabajo. Quien dice "Ahora no" sigue usando la
 * app; simplemente no se registra su recorrido, que es exactamente lo que el
 * servidor ya hace cuando falta el permiso.
 */
import { useState } from 'react';

export function DivulgacionUbicacion({
  intervaloSegundos,
  diasRetencion,
  onContinuar,
  onPosponer,
}: {
  /** Cada cuanto se toma una posicion. Sale de la politica del servidor. */
  intervaloSegundos?: number;
  /** Cuanto se conserva el recorrido. Sale de la politica del servidor. */
  diasRetencion?: number;
  onContinuar: () => void | Promise<void>;
  onPosponer: () => void;
}) {
  const [enviando, setEnviando] = useState(false);

  async function continuar() {
    setEnviando(true);
    try {
      await onContinuar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="divulgacion-fondo" role="dialog" aria-modal="true" aria-labelledby="divulgacion-titulo">
      <section className="divulgacion">
        <span className="eyebrow">Ubicación</span>
        <h2 id="divulgacion-titulo">SentryCore necesita tu ubicación</h2>

        <p className="divulgacion-principal">
          Esta aplicación <strong>recopila datos de ubicación</strong> para registrar el recorrido
          de tus rondas <strong>incluso cuando la aplicación está cerrada o no la estás usando</strong>.
        </p>

        <ul className="divulgacion-puntos">
          <li>
            <strong>Para qué.</strong> Dejar constancia de que la ronda se hizo en terreno y poder
            auxiliarte si ocurre una emergencia durante el turno.
          </li>
          <li>
            <strong>Cuándo.</strong> Solo mientras tienes una ronda en curso. Al terminarla se
            detiene: fuera de la ronda el servidor no acepta posiciones.
          </li>
          {intervaloSegundos ? (
            <li>
              <strong>Cada cuánto.</strong> Una posición cada {intervaloSegundos} segundos mientras
              dura la ronda.
            </li>
          ) : null}
          {diasRetencion ? (
            <li>
              <strong>Cuánto se guarda.</strong> El recorrido se conserva {diasRetencion} días y
              después se elimina.
            </li>
          ) : null}
          <li>
            <strong>Quién lo ve.</strong> Tu supervisor, dentro de la empresa para la que trabajas.
            No se vende ni se comparte con terceros.
          </li>
          <li>
            <strong>Mientras se registra</strong> tu teléfono muestra una notificación permanente, y
            puedes retirar tu consentimiento cuando quieras desde esta misma pantalla.
          </li>
        </ul>

        <div className="divulgacion-acciones">
          <button className="divulgacion-continuar" type="button" onClick={() => void continuar()} disabled={enviando}>
            {enviando ? 'Abriendo…' : 'Continuar'}
          </button>
          <button className="divulgacion-posponer" type="button" onClick={onPosponer} disabled={enviando}>
            Ahora no
          </button>
        </div>
        <p className="divulgacion-pie">
          Al continuar, Android te va a preguntar si permites el acceso a la ubicación. Si eliges
          «Ahora no», puedes seguir usando la aplicación: no se registrará tu recorrido.
        </p>
      </section>
    </div>
  );
}
