import type { DataSource } from 'typeorm';
import type { Job,Queue } from 'bullmq';
import { ReportDigestProcessor } from './report-digest.processor';
import type { ReportDigestService } from './report-digest.service';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';

describe('durable digest scheduler',()=>{
 it('uses stable tenant/tick jobs on retries without exposing addresses',async()=>{
  const add=jest.fn().mockResolvedValue({});const db={query:jest.fn().mockResolvedValue([{tenant_id:'tenant-a'},{tenant_id:'tenant-b'}])};
  const p=new ReportDigestProcessor(db as unknown as DataSource,{} as TenantContextService,{} as ReportDigestService,{add} as unknown as Queue);
  const job={name:'tick',timestamp:1794869100000,processedOn:1794870000000,data:{}} as Job;
  await p.process(job);await p.process(job);
  expect(add).toHaveBeenCalledTimes(4);expect(add.mock.calls[0][2].jobId).toBe(add.mock.calls[2][2].jobId);
  expect(add.mock.calls[0][2].jobId).not.toBe(add.mock.calls[1][2].jobId);expect(add.mock.calls[0][2].jobId).toMatch(/^[a-f0-9]{64}$/);
  expect(add.mock.calls[0][1]).toEqual({tenantId:'tenant-a',at:new Date(job.processedOn!).toISOString()});
 });
 it('rolls back failed mail enqueue and releases the RLS transaction for retry',async()=>{
  const runner={connect:jest.fn(),startTransaction:jest.fn(),commitTransaction:jest.fn(),rollbackTransaction:jest.fn(),release:jest.fn(),manager:{query:jest.fn().mockResolvedValue([{id:'tenant-a'}])}};
  const digest={dispatch:jest.fn().mockRejectedValue(new Error('Redis unavailable'))};
  const ctx={run:jest.fn(async(_runner:unknown,_tenant:unknown,fn:()=>Promise<unknown>)=>fn()),transactionRolledBack:jest.fn(),transactionCommitted:jest.fn()};
  const p=new ReportDigestProcessor({createQueryRunner:()=>runner} as unknown as DataSource,ctx as unknown as TenantContextService,digest as unknown as ReportDigestService,{} as Queue);
  await expect(p.process({name:'dispatch',data:{tenantId:'tenant-a',at:'2026-11-16T12:00Z'}} as Job)).rejects.toThrow('Redis unavailable');
  expect(runner.commitTransaction).not.toHaveBeenCalled();expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);expect(runner.release).toHaveBeenCalledTimes(1);
  expect(runner.manager.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id',$1,true)"),['tenant-a']);
 });
});
