import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { AuditService } from '../audit/audit.service';
import { RulesService } from '../rules/rules.service';
import { BrandingService } from '../branding/branding.service';
import { ReportsService } from './reports.service';
import { DigestAttachmentsService } from './digest-attachments.service';
import { ReportDigestService } from './report-digest.service';
import type { MailQueueService } from '../mail/mail-queue.service';
import { pdfOperands } from './pdf-text.testing';

const database=process.env.DATABASE_APP_TEST_URL?describe:describe.skip;
const tenant='a0000000-0000-4000-8000-000000000001',admin='a0000000-0000-4000-8000-000000000009';
database('optional guard disclosure with real PostgreSQL and PDF',()=>{
 let db:DataSource;
 beforeAll(async()=>{db=await new DataSource({type:'postgres',url:process.env.DATABASE_APP_TEST_URL}).initialize();});
 afterAll(async()=>db?.destroy());
 it('persists supervisor checks, redacts names when off, includes them only in the selected frequency and never reads RUT',async()=>{
  const q=db.createQueryRunner();await q.connect();await q.startTransaction();
  try {
   await q.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,admin]);
   const guard=randomUUID();await q.query("SELECT admin_create_tenant_user($1,NULL,$2,$3,'QZXSECRETPERSON','Fixture','GUARDIA')",[guard,'fixture471-'+guard,'unusable-fixture-hash']);
   const [route]=await q.query('SELECT id,site_id FROM routes LIMIT 1');
   await q.query(`INSERT INTO patrols(id,tenant_id,site_id,route_id,guard_id,status,scheduled_start_at,scheduled_end_at,closed_at,compliance_pct,expected_checkpoint_ids)
    VALUES($1,app_tenant_id(),$2,$3,$4,'completada','2040-02-01T12:00Z','2040-02-01T13:00Z','2040-02-01T12:30Z',100,'[]')`,[randomUUID(),route.site_id,route.id,guard]);
   const ctx=new TenantContextService();await ctx.run(q,tenant,async()=>{
    const config=new ConfigService({WEB_PUBLIC_URL:'https://panel.example.test'}),rules=new RulesService(ctx,new AuditService(ctx)),reports=new ReportsService(ctx,rules,new BrandingService(ctx),config),details=new DigestAttachmentsService(reports,config);
    const hidden=await reports.buildSiteSummary(route.site_id,'2040-02-01T03:00Z','2040-02-02T03:00Z',null,false,false);
    const visible=await reports.buildSiteSummary(route.site_id,'2040-02-01T03:00Z','2040-02-02T03:00Z',null,false,true);
    expect(pdfOperands(hidden.pdf)).not.toContain('QZXSECRETPERSON');expect(pdfOperands(visible.pdf)).toContain('QZXSECRETPERSON');
    const [previous]=await q.query('SELECT overrides FROM site_rules WHERE site_id=$1',[route.site_id]);
    await rules.updateSiteOverrides(route.site_id,{...previous?.overrides,reportRecipients:['recipient@example.cl'],reportDailyEnabled:true,reportMonthlyEnabled:true,reportDailyIncludeGuardNames:true,reportDailyIncludePhotos:false,reportMonthlyIncludeGuardNames:false,reportMonthlyIncludePhotos:false},admin);
    // A new resolver mirrors the worker's next committed request (the transaction is rolled back).
    const freshRules=new RulesService(ctx,new AuditService(ctx));const mail={enqueue:jest.fn().mockResolvedValue({estado:'encolado',jobId:'not-sent'})};
    const digest=new ReportDigestService(ctx,freshRules,mail as unknown as MailQueueService,details);
    expect(await digest.dispatch(tenant,new Date('2040-02-02T15:00Z'))).toEqual({queued:2});
    const daily=mail.enqueue.mock.calls.find(c=>c[0].variables.frecuencia==='diario')![0];
    expect(daily.attachments).toHaveLength(1);expect(pdfOperands(Buffer.from(daily.attachments[0].contentBase64,'base64'))).toContain('QZXSECRETPERSON');
    const monthly=mail.enqueue.mock.calls.find(c=>c[0].variables.frecuencia==='mensual')![0];expect(monthly).not.toHaveProperty('attachments');
   });
  } finally {await q.rollbackTransaction();await q.release();}
 });
});
