import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AuthGuard } from '../auth/auth.guard';
import { AUTH_REDIS } from '../auth/redis.provider';
import { MailQueueService } from '../mail/mail-queue.service';
import { renderTemplate } from '../mail/template-renderer';
import { csrfOriginProtection } from '../security/csrf-origin.middleware';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

describe('reportes públicos dentro de SentryCore', () => {
  let app: INestApplication;
  const mail = { enqueue: jest.fn() };
  const redis = { status: 'ready', eval: jest.fn() };
  const database = { query: jest.fn() };
  const origin = 'https://sentrycore.example.test';
  const input = () => ({ submissionId: randomUUID(), category: 'child-safety', message: 'Revisar el registro indicado en este reporte.' });

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [FeedbackService,
        { provide: MailQueueService, useValue: mail },
        { provide: AUTH_REDIS, useValue: redis },
        { provide: ConfigService, useValue: new ConfigService({ SUPPORT_FEEDBACK_EMAIL: 'service@example.test' }) },
      ],
    }).compile();
    app = testingModule.createNestApplication();
    app.use(csrfOriginProtection(origin));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalGuards(new AuthGuard(new JwtService(), new Reflector(), database as unknown as DataSource, redis as never));
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    redis.eval.mockResolvedValue(1);
    mail.enqueue.mockResolvedValue({ estado: 'encolado', jobId: 'durable-job' });
  });
  afterAll(async () => { await app.close(); });

  it('acepta sin sesión, entrega folio y dirige solo al buzón configurado', async () => {
    const data = input();
    const response = await request(app.getHttpServer()).post('/feedback').set('Origin', origin).send(data).expect(202);
    expect(response.body).toEqual({ receipt: `SC-${data.submissionId}`, status: 'received' });
    expect(mail.enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'service@example.test', tenantId: null }),
      { idempotencyKey: `feedback:${data.submissionId}` });
    expect(database.query).not.toHaveBeenCalled();
  });

  it('permite reportar aunque la cookie de sesión haya caducado', async () => {
    await request(app.getHttpServer()).post('/feedback').set('Origin', origin)
      .set('Cookie', 'sentrycore_access=expired').send(input()).expect(202);
    expect(database.query).not.toHaveBeenCalled();
  });

  it.each([
    { message: '   ' }, { message: 'a'.repeat(5001) }, { replyEmail: 'inválido' },
    { category: 'arbitrary' }, { submissionId: '123' },
    { tenantId: randomUUID() }, { userId: randomUUID() }, { to: 'attacker@example.test' },
    { attachment: 'not-allowed' },
  ])('rechaza entrada inválida o campos ajenos: %j', async invalid => {
    await request(app.getHttpServer()).post('/feedback').set('Origin', origin).send({ ...input(), ...invalid }).expect(400);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes desde otro sitio', async () => {
    await request(app.getHttpServer()).post('/feedback').set('Origin', 'https://attacker.test').send(input()).expect(403);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('aplica un límite independiente y no conserva la IP legible', async () => {
    redis.eval.mockResolvedValue(11);
    await request(app.getHttpServer()).post('/feedback').set('Origin', origin).send(input()).expect(429);
    expect(redis.eval.mock.calls[0]?.[2]).toMatch(/^feedback:rate:[a-f0-9]{64}$/);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it.each(['redis', 'queue', 'suppressed'])('no confirma si falla la recepción durable: %s', async failure => {
    if (failure === 'redis') redis.eval.mockRejectedValueOnce(new Error('private error'));
    if (failure === 'queue') mail.enqueue.mockRejectedValueOnce(new Error('private error'));
    if (failure === 'suppressed') mail.enqueue.mockResolvedValueOnce({ estado: 'suprimido', motivo: 'dominio_bloqueado' });
    const response = await request(app.getHttpServer()).post('/feedback').set('Origin', origin).send(input()).expect(503);
    expect(JSON.stringify(response.body)).not.toContain('private error');
    expect(response.body.receipt).toBeUndefined();
  });

  it('conserva el mensaje como texto y no lo interpreta como plantilla o HTML', async () => {
    await request(app.getHttpServer()).post('/feedback').set('Origin', origin)
      .send({ ...input(), message: '<script>alert(1)</script> {{secret}}', replyEmail: 'person@example.test' }).expect(202);
    const job = mail.enqueue.mock.calls[0]?.[0];
    const rendered = renderTemplate(job.template, job.variables);
    expect(rendered.text).toContain('<script>alert(1)</script> {{secret}}');
    expect(rendered.html).toBeUndefined();
    expect(rendered.subject).toContain('Seguridad infantil');
  });
});
