import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { isUUID } from 'class-validator';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { emptyVehicleCheck, VehicleRegistryService, type VehicleCheckResult } from './vehicle-registry.service';

export const VEHICLE_LOOKUP_QUEUE='visitor-vehicle-lookups';
export interface VehicleLookupJob {tenantId:string;actorId:string;lookupId:string;resultId:string;plate:string}

@Injectable()
export class VehicleLookupJobs {
  constructor(@InjectQueue(VEHICLE_LOOKUP_QUEUE) private readonly queue:Queue<VehicleLookupJob>) {}
  async enqueue(data:VehicleLookupJob) {
    if(await this.queue.getWaitingCount()>32)throw new Error('vehicle_queue_busy');
    await this.queue.add('lookup',data,{jobId:data.lookupId,attempts:2,backoff:{type:'fixed',delay:1000},
      removeOnComplete:{age:600,count:2000},removeOnFail:{age:3600,count:1000}});
  }
  async progress(lookupId:string,tenantId:string):Promise<VehicleCheckResult|null> {
    try {
      const job=await this.queue.getJob(lookupId);
      if(job?.data.tenantId!==tenantId)return null;
      const progress=job.progress;
      return typeof progress==='object'&&progress!==null&&'checkedAt' in progress?progress as VehicleCheckResult:null;
    }catch{return null;}
  }
}

@Processor(VEHICLE_LOOKUP_QUEUE,{concurrency:2})
export class VehicleLookupProcessor extends WorkerHost {
  private readonly logger=new Logger(VehicleLookupProcessor.name);
  constructor(private readonly database:DataSource,private readonly vehicles:VehicleRegistryService) {super();}

  async finish(data:VehicleLookupJob,result:VehicleCheckResult) {
    if(![data.tenantId,data.actorId,data.lookupId,data.resultId].every(value=>isUUID(value)))throw new Error('invalid_vehicle_job');
    await this.database.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[data.tenantId,data.actorId]);
      // Los antecedentes son evidencia append-only: nunca UPDATE ni permisos nuevos.
      await manager.query(`INSERT INTO visitor_vehicle_checks(id,tenant_id,site_id,guard_id,plate,result)
        SELECT $1,tenant_id,site_id,guard_id,plate,$2::jsonb FROM visitor_vehicle_checks
        WHERE id=$3 AND tenant_id=$4 AND guard_id=$5 AND plate=$6
        ON CONFLICT(id) DO NOTHING`,[data.resultId,JSON.stringify({...result,lookupPending:false}),
        data.lookupId,data.tenantId,data.actorId,data.plate]);
    });
  }

  async process(job:Job<VehicleLookupJob>) {
    const result=await this.vehicles.lookup(job.data.plate,async progress=>{await job.updateProgress(progress);});
    await this.finish(job.data,result);
  }

  @OnWorkerEvent('failed')
  async onFailed(job:Job<VehicleLookupJob>|undefined) {
    if(!job||job.attemptsMade<Number(job.opts.attempts??1))return;
    const progress=typeof job.progress==='object'?job.progress:{};
    await this.finish(job.data,{...emptyVehicleCheck(),...progress,lookupPending:false,
      officialCheck:{source:'Auto Seguro',status:'no_disponible',checkedAt:null}}).catch(()=>undefined);
    this.logger.warn(JSON.stringify({event:'vehicle_lookup_unavailable',tenant_id:job.data.tenantId,job_id:job.id}));
  }
}
