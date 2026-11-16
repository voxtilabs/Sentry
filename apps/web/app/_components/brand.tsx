/**
 * La marca en la esquina del panel (#117).
 *
 * Con `nombre` o `logoUri` dibuja la marca DE LA EMPRESA; sin ellos, la del
 * producto. La distincion importa: en un producto white-label el cliente final
 * no deberia notar que el sistema es de un tercero, asi que en cuanto el tenant
 * tiene marca propia, "SentryCore" desaparece de su pantalla.
 *
 * El logo llega como data URI desde `tenant_branding.logo_uri` (nunca una URL
 * externa: el panel no le cuenta a un tercero cuando se abre) y se dibuja con
 * `<img>` comun — un data URI no gana nada con el pipeline de next/image y este
 * componente tambien se usa en contextos sin optimizador.
 */
export function Brand({
  nombre,
  logoUri,
}: {
  /** Nombre comercial del tenant; sin el, la marca del producto. */
  nombre?: string | null;
  /** Logo del tenant como data URI; sin el, el escudo del producto. */
  logoUri?: string | null;
}) {
  const etiqueta = nombre ?? 'SentryCore';
  return (
    <div className="brand" aria-label={etiqueta}>
      {logoUri ? (
        // alt vacio a proposito: el nombre ya esta al lado como texto y
        // repetirlo hace que el lector de pantalla lo diga dos veces.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="brand-logo" src={logoUri} alt="" />
      ) : (
        <span className="brand-mark" aria-hidden="true">
          {/*
            * El isotipo de SentryCore (voxtilabs/SentryBranding). Antes habia
            * un escudo generico dibujado a mano que no era la marca de nadie.
            *
            * Va PEGADO EN LINEA y con `currentColor` para que herede el color
            * del contexto: la esquina del panel lo pinta oscuro y la barra del
            * guardia, clara. Un <img> quedaria aislado y habria que duplicar
            * el archivo por cada fondo.
            */}
          <svg viewBox="0 0 168 168" fill="none" role="img">
            <path
              d="M 138 92 L 138 112 A 40 40 0 0 1 98 152 L 56 152 A 40 40 0 0 1 16 112 L 16 70 A 40 40 0 0 1 56 30 L 76 30"
              stroke="currentColor"
              strokeWidth="32"
              strokeLinecap="round"
            />
            <rect x="108" y="0" width="60" height="60" rx="22" fill="currentColor" />
          </svg>
        </span>
      )}
      <span>
        <strong>{nombre ?? 'SentryCore'}</strong>
      </span>
    </div>
  );
}
