import { ResendProvider } from './resend.provider';

const PLANTILLA = { subject: 'Ronda {{sitio}}', text: 'Cumplimiento {{pct}}%' };
/** Sin variables: para las pruebas que no miran la interpolacion. */
const SIMPLE = { subject: 'Aviso', text: 'La ronda termino.' };

function proveedor(responder: (url: string, init: RequestInit) => Promise<Response>) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init ?? {});
  }) as unknown as typeof fetch;
  return {
    llamadas,
    resend: new ResendProvider({
      from: 'SentryCore <noreply@mail.control.voxtilabs.cl>',
      apiKey: 'llave-de-prueba',
      fetchImpl,
    }),
  };
}

type CuerpoEnviado = Record<string, unknown>;

function cuerpoDe(llamadas: Array<{ url: string; init: RequestInit }>, i = 0): CuerpoEnviado {
  const llamada = llamadas[i];
  if (!llamada) throw new Error(`no hubo llamada ${i} a Resend`);
  return JSON.parse(String(llamada.init.body)) as CuerpoEnviado;
}

function urlDe(llamadas: Array<{ url: string; init: RequestInit }>, i = 0) {
  const llamada = llamadas[i];
  if (!llamada) throw new Error(`no hubo llamada ${i} a Resend`);
  return { url: llamada.url, method: llamada.init.method };
}

const ok = (cuerpo: unknown = { id: 'msg-123' }) =>
  Promise.resolve(new Response(JSON.stringify(cuerpo), { status: 200 }));

describe('ResendProvider', () => {
  it('entrega por HTTPS y devuelve el id que dio Resend', async () => {
    const { resend, llamadas } = proveedor(() => ok());
    const r = await resend.send('jefe@empresa.cl', PLANTILLA, { sitio: 'Bodega', pct: 92 }, 't1');

    expect(r.messageId).toBe('msg-123');
    expect(r.accepted).toEqual(['jefe@empresa.cl']);
    expect(r.rejected).toEqual([]);
    expect(urlDe(llamadas)).toEqual({ url: 'https://api.resend.com/emails', method: 'POST' });
  });

  it('rellena las variables de la plantilla antes de enviar', async () => {
    const { resend, llamadas } = proveedor(() => ok());
    await resend.send('jefe@empresa.cl', PLANTILLA, { sitio: 'Bodega', pct: 92 }, 't1');

    const cuerpo = cuerpoDe(llamadas);
    expect(cuerpo.subject).toBe('Ronda Bodega');
    expect(cuerpo.text).toBe('Cumplimiento 92%');
    // Resend espera una lista, no una cadena: mandarla suelta devuelve 422.
    expect(cuerpo.to).toEqual(['jefe@empresa.cl']);
  });

  it('manda el PDF en base64 tal como viene de la cola, sin recodificarlo', async () => {
    const { resend, llamadas } = proveedor(() => ok());
    await resend.send('jefe@empresa.cl', SIMPLE, {}, 't1', [
      { filename: 'informe.pdf', contentType: 'application/pdf', contentBase64: 'QkFTRTY0' },
    ]);

    const cuerpo = cuerpoDe(llamadas);
    expect(cuerpo.attachments).toEqual([
      { filename: 'informe.pdf', content: 'QkFTRTY0', content_type: 'application/pdf' },
    ]);
  });

  it('propaga el motivo que da Resend, no un "fallo" generico', async () => {
    // Quien mira la fila de mail_deliveries tiene que poder responder "por que
    // no llego" sin entrar al servidor.
    const { resend } = proveedor(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'The domain is not verified' }), { status: 403 }),
      ),
    );
    await expect(resend.send('jefe@empresa.cl', SIMPLE, {}, 't1')).rejects.toThrow(
      /domain is not verified/i,
    );
  });

  it('falla con el codigo HTTP cuando Resend no explica nada', async () => {
    const { resend } = proveedor(() => Promise.resolve(new Response('', { status: 502 })));
    await expect(resend.send('jefe@empresa.cl', SIMPLE, {}, 't1')).rejects.toThrow(/502/);
  });

  it('rechaza un destinatario vacio antes de gastar una llamada', async () => {
    const { resend, llamadas } = proveedor(() => ok());
    await expect(resend.send('   ', SIMPLE, {}, 't1')).rejects.toThrow(/destinatario/i);
    expect(llamadas).toHaveLength(0);
  });

  it('no se construye sin llave: fallar al arrancar es mejor que fallar en silencio', () => {
    expect(() => new ResendProvider({ from: 'a@b.cl', apiKey: '  ' })).toThrow(/RESEND_API_KEY/);
  });

  it('no manda html cuando la plantilla no lo trae', async () => {
    const { resend, llamadas } = proveedor(() => ok());
    await resend.send('jefe@empresa.cl', SIMPLE, {}, 't1');
    expect(cuerpoDe(llamadas)).not.toHaveProperty('html');
  });
});
