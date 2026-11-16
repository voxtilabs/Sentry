import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { AuditService } from '../audit/audit.service';
import { RulesService } from '../rules/rules.service';
import { AdminService } from '../admin/admin.service';
import { GuardRegistrationController } from '../admin/guard-registration.controller';
import { GuardQuotaService } from './guard-quota.service';
import { GuardPersonalService } from './guard-personal.service';
import { OperationsService } from './operations.service';
const url=process.env.DATABASE_APP_TEST_URL;
const database=url?describe:describe.skip;
const tenant='a0000000-0000-4000-8000-000000000001',admin='a0000000-0000-4000-8000-000000000009';
database('site guard enrollment and optional RUT against PostgreSQL',()=>{
 let db:DataSource;
 beforeAll(async()=>{db=new DataSource({type:'postgres',url,entities:[]});await db.initialize();});
 afterAll(async()=>db.destroy());
 it('permite al supervisor crear solo guardias en su recinto; cifra y aísla el RUT',async()=>{
  const q=db.createQueryRunner();await q.connect();await q.startTransaction();
  try{
   await q.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,admin]);
   const [site]=await q.query('SELECT id FROM sites WHERE is_active ORDER BY id LIMIT 1');
   const supervisor=randomUUID();await q.query("SELECT admin_create_tenant_user($1,NULL,$2,$3,'Supervisor','Integración','SUPERVISOR')",[supervisor,'test460-'+supervisor,'unusable-integration-hash']);
   await q.query('INSERT INTO supervisor_sites(tenant_id,supervisor_id,site_id) VALUES(app_tenant_id(),$1,$2)',[supervisor,site.id]);
   await q.query("SELECT set_config('app.user_id',$1,true)",[supervisor]);
   const ctx=new TenantContextService();await ctx.run(q,tenant,async()=>{
    const audit=new AuditService(ctx),rules=new RulesService(ctx,audit),quota=new GuardQuotaService(ctx,rules),ops=new OperationsService(ctx,rules),personal=new GuardPersonalService(ctx,new ConfigService({JWT_SECRET:'integration-key-only'}),audit);
    const service=new AdminService(ctx,{} as never,{} as never,audit,quota),controller=new GuardRegistrationController(service,ops,personal,audit);
    const actor={sub:supervisor,role:'SUPERVISOR' as const,tenant_id:tenant};
    const guard=await controller.create({siteId:site.id,givenName:'Guardia',familyName:'Integración',rut:'12.345.678-5'},{user:actor} as never);
    const rows=await q.query('SELECT role_key FROM memberships WHERE user_id=$1',[guard.id]);expect(rows.map((r:{role_key:string})=>r.role_key)).toEqual(['GUARDIA']);
    expect((await personal.read(guard.id,actor)).rut).toBe('12345678-5');
    const [stored]=await q.query('SELECT encrypted_rut FROM guard_personal_data WHERE user_id=$1',[guard.id]);expect(stored.encrypted_rut.includes(Buffer.from('12345678-5'))).toBe(false);
    expect((await ops.guards(actor)).find((g:{id:string})=>g.id===guard.id)).not.toHaveProperty('rut');
    await q.query("SELECT set_config('app.tenant_id',$1,true)",['a0000000-0000-4000-8000-000000000002']);expect(await q.query('SELECT * FROM guard_personal_data WHERE user_id=$1',[guard.id])).toEqual([]);
    await q.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
    await q.query('SAVEPOINT forbidden_enrollment');
    await expect(q.query('SELECT guard_register_in_site($1,$2,$3,$4,$5,$6)',[randomUUID(),'foreign-'+randomUUID(),'fixture','Persona','Prueba',randomUUID()])).rejects.toMatchObject({driverError:{code:'42501'}});
    await q.query('ROLLBACK TO SAVEPOINT forbidden_enrollment');await q.query('RELEASE SAVEPOINT forbidden_enrollment');
    await personal.write(guard.id,'',actor);expect((await personal.read(guard.id,actor)).rut).toBeNull();
   });
  }finally{await q.rollbackTransaction();await q.release();}
 });
});
