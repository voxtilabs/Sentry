import { HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';

import { AUTH_REDIS } from '../auth/redis.provider';
import { MailQueueService } from '../mail/mail-queue.service';
import type { FeedbackDto } from './feedback.dto';

// Límite técnico contra abuso del formulario público, sin bloquear el login.
const WINDOW_SECONDS = 600;
const MAX_SUBMISSIONS = 10;
const RATE_LIMIT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    private readonly mail: MailQueueService,
    private readonly config: ConfigService,
  ) {}

  async submit(input: FeedbackDto, sourceIp: string) {
    const receipt = `SC-${input.submissionId}`;
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const ipHash = createHash('sha256').update(sourceIp).digest('hex');
      const attempts = await this.redis.eval(RATE_LIMIT, 1, `feedback:rate:${ipHash}`, WINDOW_SECONDS);
      if (Number(attempts) > MAX_SUBMISSIONS) {
        throw new HttpException('Espera unos minutos antes de enviar otro reporte.', HttpStatus.TOO_MANY_REQUESTS);
      }
      const result = await this.mail.enqueue({
        to: this.config.getOrThrow<string>('SUPPORT_FEEDBACK_EMAIL'),
        tenantId: null,
        template: {
          subject: 'SentryCore · {{category}} · {{receipt}}',
          text: 'Reporte enviado desde SentryCore\nFolio: {{receipt}}\nTipo: {{category}}\nCorreo de respuesta (no verificado): {{replyEmail}}\n\n{{message}}',
        },
        variables: {
          receipt,
          category: input.category === 'child-safety' ? 'Seguridad infantil' : 'Ayuda y comentarios',
          replyEmail: input.replyEmail ?? 'No proporcionado',
          message: input.message,
        },
      }, { idempotencyKey: `feedback:${input.submissionId}` });
      if (result.estado !== 'encolado') throw new Error('feedback destination suppressed');
      // Se confirma recepción durable en Redis, no entrega SMTP ni revisión humana.
      return { receipt, status: 'received' as const };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Nunca devolver mensajes del proveedor, ni registrar el contenido o la IP.
      throw new ServiceUnavailableException('No pudimos recibir tu reporte. Conserva el texto e inténtalo nuevamente.');
    }
  }
}
