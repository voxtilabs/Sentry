import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { createHash } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { ReportDigestService } from './report-digest.service';

export const DIGEST_QUEUE = 'report-digest';
const INTERVAL = 15 * 60_000;
interface DigestJob {tenantId?: string; at?: string}
@Injectable()
export class ReportDigestSchedule implements OnModuleInit {
  private readonly logger = new Logger(ReportDigestSchedule.name);
  constructor(@InjectQueue(DIGEST_QUEUE) private readonly queue: Queue) {}
  onModuleInit(): void {
    void this.queue.upsertJobScheduler('report-digest-schedule', {every:INTERVAL}, {
      name:'tick',data:{},opts:{removeOnComplete:20,removeOnFail:50,attempts:5,backoff:{type:'exponential',delay:5000}},
    }).catch(()=>this.logger.error(JSON.stringify({event:'digest_schedule_unavailable'})));
  }
}
@Processor(DIGEST_QUEUE, {concurrency:2})
export class ReportDigestProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportDigestProcessor.name);
  constructor(private readonly db:DataSource,private readonly ctx:TenantContextService,
    private readonly digest:ReportDigestService,@InjectQueue(DIGEST_QUEUE) private readonly queue:Queue<DigestJob>) {super();}
  @OnWorkerEvent('failed')
  onFailed(job: Job<DigestJob> | undefined): void {
    if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1))
      this.logger.error(JSON.stringify({event:'digest_dead_letter',tenant_id:job.data.tenantId,job_id:job.id}));
  }
  async process(job: Job<DigestJob>): Promise<unknown> {
    if (job.name === 'tick') {
      const tenants = await this.db.query<Array<{tenant_id:string}>>('SELECT tenant_id FROM report_digest_tenants()');
      // A scheduled job can have been created one interval before it runs.
      const tickAt = job.processedOn ?? job.timestamp;
      const at = new Date(tickAt).toISOString();
      for (const row of tenants) {
        const jobId = createHash('sha256').update(`${row.tenant_id}:${Math.floor(tickAt/INTERVAL)}`).digest('hex');
        await this.queue.add('dispatch',{tenantId:row.tenant_id,at}, {jobId,attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:100,removeOnFail:100});
      }
      return {tenants:tenants.length};
    }
    if (job.name !== 'dispatch' || !job.data.tenantId || !job.data.at) throw new Error('Invalid digest job');
    const runner = this.db.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      await runner.manager.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','',true),set_config('app.support_access_id','',true)`,[job.data.tenantId]);
      // Recheck after enqueue: a company may have been suspended meanwhile.
      const active = await runner.manager.query('SELECT id FROM tenants WHERE id=app_tenant_id() AND status=\'active\'');
      const result = active.length ? await this.ctx.run(runner,job.data.tenantId,()=>this.digest.dispatch(job.data.tenantId!,new Date(job.data.at!))) : {queued:0};
      await runner.commitTransaction();
      await this.ctx.transactionCommitted(runner);
      return result;
    } catch (error) { await runner.rollbackTransaction(); this.ctx.transactionRolledBack(runner); throw error; }
    finally {await runner.release();}
  }
}
