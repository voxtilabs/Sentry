import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { patrolRulesSchema } from '@sentrycore/shared';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { MailQueueService } from '../mail/mail-queue.service';
import type { RulesService } from '../rules/rules.service';
import type { DigestAttachmentsService } from './digest-attachments.service';
import { ReportDigestService } from './report-digest.service';
import { OperationsService } from '../operations/operations.service';
import { AuditService } from '../audit/audit.service';
import { RulesService as ActualRules } from '../rules/rules.service';
import { ForbiddenException,NotFoundException } from '@nestjs/common';

const database = process.env.DATABASE_APP_TEST_URL ? describe : describe.skip;
const tenant = 'a0000000-0000-4000-8000-000000000001';
const admin = 'a0000000-0000-4000-8000-000000000009';
database('report digests with real PostgreSQL / restricted RLS role',()=>{
 let db:DataSource, q:QueryRunner, ctx:TenantContextService;
 beforeAll(async()=>{db=await new DataSource({type:'postgres',url:process.env.DATABASE_APP_TEST_URL}).initialize();});
 afterAll(async()=>{await db?.destroy();});
 beforeEach(async()=>{q=db.createQueryRunner();await q.connect();await q.startTransaction();
  await q.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,admin]);ctx=new TenantContextService();});
 afterEach(async()=>{await q.rollbackTransaction();await q.release();});
 it('uses local calendar boundaries across DST, year changes and month lengths',async()=>{
  const service=new ReportDigestService({manager:q.manager} as TenantContextService,{} as RulesService,{} as MailQueueService,{} as DigestAttachmentsService);
  const dst=await service.period('daily','America/Santiago',8,new Date('2026-09-07T12:00:00Z'));
  expect(dst.due).toBe(true);expect(dst.start_at.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  expect(dst.end_at.getTime()-dst.start_at.getTime()).toBe(23*3600_000);
  const week=await service.period('weekly','America/Santiago',8,new Date('2027-01-04T12:00:00Z'));
  expect(week.label).toBe('28/12/2026 – 03/01/2027');
  const month=await service.period('monthly','America/Santiago',8,new Date('2026-03-01T10:00:00Z'));
  expect(month.label).toBe('01/02/2026 – 28/02/2026');expect(month.due).toBe(false);
 });
 it('consolidates two sites, isolates monthly recipients and deduplicates after Redis loss',async()=>{
  const [source]=await q.query(`SELECT r.id AS route_id,r.site_id,m.user_id AS guard_id FROM routes r CROSS JOIN memberships m WHERE m.role_key='GUARDIA' LIMIT 1`);
  const second=randomUUID();await q.query(`INSERT INTO sites(id,tenant_id,name,branch_name,address) VALUES($1,app_tenant_id(),'Prueba segundo recinto','Prueba','Fixture')`,[second]);
  await q.query(`INSERT INTO patrols(id,tenant_id,site_id,route_id,guard_id,status,scheduled_start_at,scheduled_end_at,closed_at,compliance_pct,expected_checkpoint_ids)
    VALUES($1,app_tenant_id(),$2,$3,$4,'incompleta','2040-01-16T12:00Z','2040-01-16T13:00Z','2040-01-16T12:30Z',74,'[]')`,[randomUUID(),source.site_id,source.route_id,source.guard_id]);
  const enabled=new Set([source.site_id,second]);
  const rules={effective:async({siteId}:{siteId:string})=>patrolRulesSchema.parse(enabled.has(siteId)?{
   reportRecipients:['global@example.cl'],reportDailyEnabled:true,reportWeeklyEnabled:true,reportMonthlyEnabled:true,
   reportMonthlyRecipients:['cliente@example.cl'],complianceThreshold:75,reportDigestHour:siteId===second?9:8}: {})};
  const mail={enqueue:jest.fn().mockResolvedValue({estado:'encolado',jobId:'test'})};
  await ctx.run(q,tenant,async()=>{
   const service=new ReportDigestService(ctx,rules as unknown as RulesService,mail as unknown as MailQueueService,{} as DigestAttachmentsService);
   expect(await service.dispatch(tenant,new Date('2040-01-17T11:00Z'))).toEqual({queued:2});
   expect(await service.dispatch(tenant,new Date('2040-01-17T12:00Z'))).toEqual({queued:1});
   expect(mail.enqueue).toHaveBeenCalledTimes(3);
   const daily=mail.enqueue.mock.calls.find(c=>c[0].variables.frecuencia==='diario')![0];
   expect(daily.to).toBe('global@example.cl');expect(daily.variables.contenido).toContain('Bajo el mínimo: 1');
   expect(daily.variables.recintos).toContain('Prueba segundo recinto');expect(daily).not.toHaveProperty('attachments');
   const monthly=mail.enqueue.mock.calls.find(c=>c[0].variables.frecuencia==='mensual')![0];expect(monthly.to).toBe('cliente@example.cl');
   mail.enqueue.mockClear();expect(await service.dispatch(tenant,new Date('2040-01-17T13:00Z'))).toEqual({queued:0});
   expect(mail.enqueue).not.toHaveBeenCalled();
  });
  expect((await q.query('SELECT * FROM report_digest_deliveries')).length).toBe(3);
  await q.query("SELECT set_config('app.tenant_id',$1,true)",['b0000000-0000-4000-8000-000000000001']);
  expect(await q.query('SELECT * FROM report_digest_deliveries')).toEqual([]);
  await q.query("SELECT set_config('app.tenant_id','',true)");expect(await q.query('SELECT * FROM report_digest_deliveries')).toEqual([]);
 });
 it('rejects cross-site supervisors, preserves unrelated rules and supports assigned supervisors',async()=>{
  const [site]=await q.query('SELECT id FROM sites WHERE is_active LIMIT 1');
  const supervisor='a0000000-0000-4000-8000-000000000008';
  await q.query('INSERT INTO supervisor_sites(tenant_id,site_id,supervisor_id) VALUES(app_tenant_id(),$1,$2) ON CONFLICT DO NOTHING',[site.id,supervisor]);
  const other=randomUUID();await q.query(`INSERT INTO sites(id,tenant_id,name,branch_name,address) VALUES($1,app_tenant_id(),'No asignado','Prueba','Fixture')`,[other]);
  await ctx.run(q,tenant,async()=>{
   const rules=new ActualRules(ctx,new AuditService(ctx));const ops=new OperationsService(ctx,rules);
   const actor={sub:supervisor,role:'SUPERVISOR' as const};
   await expect(ops.recipients(other,actor)).rejects.toBeInstanceOf(ForbiddenException);
   await expect(ops.recipients(randomUUID(),actor)).rejects.toBeInstanceOf(NotFoundException);
   const before=await rules.effective({siteId:site.id});
   const saved=await ops.setRecipients(site.id,['global@example.cl'],actor,{recipients:['global@example.cl'],onlyBelowThreshold:true,threshold:75,monthlyEnabled:true,monthlyRecipients:['cliente@example.cl'],monthlyIncludePhotos:true,monthlyIncludeGuardNames:false});
   expect(saved).toMatchObject({threshold:75,onlyBelowThreshold:true,monthlyRecipients:['cliente@example.cl'],monthlyEnabled:true,monthlyIncludePhotos:true,monthlyIncludeGuardNames:false});
   expect((await rules.effective({siteId:site.id})).taskPhotoMaxCount).toBe(before.taskPhotoMaxCount);
  });
 });
 it('enables and forces RLS, denies PUBLIC function access and denies modifying the ledger',async()=>{
  const [table]=await q.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='report_digest_deliveries'::regclass");
  expect(table).toMatchObject({relrowsecurity:true,relforcerowsecurity:true});
  const [role]=await q.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');expect(role).toEqual({rolsuper:false,rolbypassrls:false});
  const [access]=await q.query("SELECT EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid='report_digest_tenants()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_access");expect(access.public_access).toBe(false);
  expect(await q.query('SELECT tenant_id FROM report_digest_tenants()')).toEqual([]);
  const [priv]=await q.query("SELECT has_table_privilege(current_user,'report_digest_deliveries','UPDATE') AS update,has_table_privilege(current_user,'report_digest_deliveries','DELETE') AS delete");expect(priv).toEqual({update:false,delete:false});
 });
});
