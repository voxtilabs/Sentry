import { DelayedError, type Job } from 'bullmq';
import type { DataSource } from 'typeorm';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { EnvioInformeProcessor } from './envio-informe.processor';
import type { EnvioInformeService } from './envio-informe.service';
import { omitir, type EnvioInformeJobData } from './envio-informe.types';

it('esperar evidencia aplaza el mismo job con su lock y no consume reintentos de fallo', async () => {
  const runner = { connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(), release: jest.fn(), manager: { query: jest.fn() } };
  const envio = { despachar: jest.fn().mockResolvedValue(omitir('ronda', 'evidencia_pendiente')) };
  const ctx = { run: async (_runner: unknown, fn: () => Promise<unknown>) => fn() };
  const processor = new EnvioInformeProcessor({ createQueryRunner: () => runner } as unknown as DataSource,
    ctx as unknown as TenantContextService, envio as unknown as EnvioInformeService);
  const mover = jest.fn().mockResolvedValue(undefined);
  const job = { data: { tenantId: 'tenant', patrolId: 'ronda', closingCheckpointId: 'ultimo',
    closingPhotoRequired: true }, moveToDelayed: mover } as unknown as Job<EnvioInformeJobData>;
  await expect(processor.process(job, 'lock-del-worker')).rejects.toBeInstanceOf(DelayedError);
  expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  expect(mover).toHaveBeenCalledWith(expect.any(Number), 'lock-del-worker');
  expect(envio.despachar).toHaveBeenCalledWith('tenant', 'ronda', {
    closingCheckpointId: 'ultimo', closingPhotoRequired: true,
  });
});
