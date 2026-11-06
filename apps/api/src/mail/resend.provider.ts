import { Logger } from '@nestjs/common';

import type {
  MailAttachment,
  MailDelivery,
  MailProvider,
  MailTemplate,
  MailTemplateVariables,
} from './mail-provider';
import { renderTemplate } from './template-renderer';

/**
 * Entrega por la API HTTP de Resend, no por SMTP (#231).
 *
 * EXISTE PORQUE EL SMTP NO SALE. Desde el VPS de produccion, los puertos 465 y
 * 2465 hacia `smtp.resend.com` terminan en `Connection timeout`: la aplicacion
 * encola, reintenta y marca fallido, sin que nada llegue. Comprobado contra la
 * propia cuenta de Resend: el unico remitente que aparece ahi es el monitor de
 * Proxmox de Bruno, que corre en OTRA maquina. SentryCore no ha entregado
 * jamas un correo desde ese servidor.
 *
 * El 443 si sale —la API se sirve por HTTPS y Dokploy clona de GitHub—, asi que
 * la misma cuenta y el mismo dominio verificado se usan por otra puerta. No
 * hace falta que nadie abra un puerto en un servidor al que no tenemos acceso.
 *
 * Se mantiene `smtp` como driver: un cliente que se autohospeda y tiene su
 * propio relay lo sigue usando. Esto es una opcion mas, no un reemplazo.
 */

/** Respuesta util de `POST /emails`. El resto del cuerpo no se usa. */
interface RespuestaResend {
  readonly id?: string;
  readonly message?: string;
  readonly name?: string;
}

export interface OpcionesResend {
  readonly from: string;
  readonly apiKey: string;
  /** Inyectable para las pruebas; por defecto el `fetch` del runtime. */
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const URL_BASE = 'https://api.resend.com';
/**
 * Un envio que tarda mas que esto no va a completarse: el job de BullMQ
 * reintenta, y dejarlo colgado ocupa un worker que otros correos necesitan.
 */
const MS_ESPERA = 20_000;

export class ResendProvider implements MailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opciones: OpcionesResend) {
    if (opciones.apiKey.trim().length === 0) {
      throw new Error('MAIL_DRIVER=resend requiere RESEND_API_KEY');
    }
    this.fetchImpl = opciones.fetchImpl ?? fetch;
    this.baseUrl = (opciones.baseUrl ?? URL_BASE).replace(/\/+$/, '');
  }

  async send(
    to: string,
    template: MailTemplate,
    vars: MailTemplateVariables,
    tenantId: string | null,
    attachments?: readonly MailAttachment[],
  ): Promise<MailDelivery> {
    if (to.trim().length === 0) {
      throw new Error('El destinatario de correo es obligatorio');
    }

    const rendered = renderTemplate(template, vars);
    const cuerpo = {
      from: this.opciones.from,
      to: [to],
      subject: rendered.subject,
      text: rendered.text,
      ...(rendered.html === undefined ? {} : { html: rendered.html }),
      /*
       * Resend recibe el adjunto en base64, que es exactamente como ya viaja
       * por la cola: el PDF del informe no se decodifica y se vuelve a
       * codificar por el camino.
       */
      ...(attachments === undefined || attachments.length === 0
        ? {}
        : {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.contentBase64,
              content_type: a.contentType,
            })),
          }),
    };

    const respuesta = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opciones.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(MS_ESPERA),
    });

    const datos = (await respuesta.json().catch(() => ({}))) as RespuestaResend;

    if (!respuesta.ok) {
      /*
       * El motivo va en el error y NO solo en el log: quien mira la fila de
       * `mail_deliveries` tiene que poder responder "por que no llego" sin
       * entrar al servidor. Resend explica de verdad —dominio no verificado,
       * destinatario invalido, cuota— y esa frase vale mas que "fallo".
       */
      const motivo = datos.message ?? datos.name ?? `HTTP ${respuesta.status}`;
      throw new Error(`Resend rechazo el envio: ${motivo}`);
    }

    const messageId = datos.id ?? '';
    this.logger.log(
      JSON.stringify({
        event: 'mail_sent',
        tenant_id: tenantId,
        transport: 'resend',
        message_id: messageId,
      }),
    );

    /*
     * Resend acepta el correo y lo entrega despues, asi que en este punto solo
     * se sabe que lo tomo. Se reporta como aceptado, igual que hace SMTP con un
     * 250: el rechazo posterior llega por webhook, que es donde corresponde.
     */
    return { messageId, accepted: [to], rejected: [] };
  }
}
