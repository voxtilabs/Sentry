import {randomUUID} from 'node:crypto';
import {DataSource,type QueryRunner} from 'typeorm';
import Redis from 'ioredis';
import {JwtService} from '@nestjs/jwt';
import {ForbiddenException} from '@nestjs/common';
import {AuthService} from './auth.service';
import type {MailService} from './mail.service';
import type {AuthenticatedUser} from './auth.guard';
const database=process.env.DATABASE_TEST_URL&&process.env.REDIS_TEST_URL?describe:describe.skip;
database('staff portfolio and assignment permissions on PostgreSQL/RLS + Redis',()=>{
 let db:DataSource,q:QueryRunner,redis:Redis,auth:AuthService;
 const a=randomUUID(),b=randomUUID(),c=randomUUID(),owner=randomUUID(),sup=randomUUID(),guard=randomUUID(),platform=randomUUID(),foreignOwner=randomUUID(),siteA=randomUUID(),siteA2=randomUUID(),siteB=randomUUID(),siteC=randomUUID();
 const user=(id:string,role:AuthenticatedUser['role'],tenant:string|null=a):AuthenticatedUser=>({sub:id,role,tenant_id:tenant,sid:randomUUID()});
 beforeAll(async()=>{db=await new DataSource({type:'postgres',url:process.env.DATABASE_TEST_URL}).initialize();redis=new Redis(process.env.REDIS_TEST_URL!);});
 afterAll(async()=>{await db.destroy();await redis.quit();});
 beforeEach(async()=>{
  q=db.createQueryRunner();await q.connect();await q.startTransaction();
  for(const [id,name] of [[a,'One'],[b,'Two'],[c,'Hidden']])await q.query(`INSERT INTO tenants(id,slug,legal_name,display_name,plan_key) SELECT $1,$2,$3,$3,plan_key FROM tenants LIMIT 1`,[id,'fixture473-'+id,name]);
  for(const [id,name] of [[owner,'Owner'],[sup,'Supervisor'],[guard,'Guard'],[platform,'Platform'],[foreignOwner,'Foreign']])await q.query(`INSERT INTO users(id,email,password_hash,given_name,family_name) VALUES($1,$2,'unusable-fixture-hash',$3,'Test')`,[id,id+'@example.test',name]);
  for(const [tenant,id,role] of [[a,owner,'ADMIN'],[b,owner,'ADMIN'],[a,sup,'SUPERVISOR'],[a,guard,'GUARDIA'],[c,foreignOwner,'ADMIN']])await q.query('INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,$3)',[tenant,id,role]);
  await q.query("INSERT INTO platform_memberships(user_id,role_key) VALUES($1,'SUPERADMIN')",[platform]);
  for(const [tenant,id,name] of [[a,siteA,'A'],[a,siteA2,'A2'],[b,siteB,'B'],[c,siteC,'Hidden']])await q.query("INSERT INTO sites(id,tenant_id,name,branch_name,address) VALUES($1,$2,$3,'Fixture','Fixture')",[id,tenant,name]);
  await q.query('INSERT INTO supervisor_sites(tenant_id,supervisor_id,site_id) VALUES($1,$2,$3)',[a,sup,siteA]);
  await q.query('SET LOCAL ROLE sentrycore_app');
  auth=new AuthService({transaction:async(fn:(manager:typeof q.manager)=>Promise<unknown>)=>fn(q.manager)} as unknown as DataSource,new JwtService({secret:'fixture-only-secret-more-than-thirty-two-characters'}),redis,{} as MailService);
 });
 afterEach(async()=>{await auth.revokeAllSessions(owner);await auth.revokeAllSessions(sup);await q.rollbackTransaction();await q.release();});
 it('shows only own companies and assigned sites, never passwords or foreign tenants',async()=>{
  const own=await auth.staffCompanies(user(owner,'ADMIN'));expect(own.companies.map(x=>x.tenantId).sort()).toEqual([a,b].sort());expect(own.companies.find(x=>x.tenantId===a)?.sites).toHaveLength(2);
  const restricted=await auth.staffCompanies(user(sup,'SUPERVISOR'));expect(restricted.companies).toHaveLength(1);expect(restricted.companies[0]?.sites.map(s=>s.id)).toEqual([siteA]);
  expect(JSON.stringify(own)).not.toContain('password');
  await expect(auth.staffCompanies(user(guard,'GUARDIA'))).rejects.toBeInstanceOf(ForbiddenException);await expect(auth.staffCompanies(user(platform,'SUPERADMIN',null))).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('lets an owner assign an existing supervisor to another owned company; does not touch history or other users',async()=>{
  const directory=await auth.supervisionDirectory(user(owner,'ADMIN')) as {companies:Array<{id:string}>;supervisors:Array<{id:string}>};expect(directory.companies.map(x=>x.id).sort()).toEqual([a,b].sort());expect(directory.supervisors.map(x=>x.id)).toEqual([sup]);
  await auth.setSupervisionAccess(user(owner,'ADMIN'),{tenantId:b,supervisorId:sup,siteIds:[siteB]});
  const portfolio=await auth.staffCompanies(user(sup,'SUPERVISOR'));expect(portfolio.companies).toHaveLength(2);expect(portfolio.companies.find(x=>x.tenantId===b)?.sites.map(s=>s.id)).toEqual([siteB]);
  await auth.setSupervisionAccess(user(owner,'ADMIN'),{tenantId:a,supervisorId:sup,siteIds:[]});expect((await auth.staffCompanies(user(sup,'SUPERVISOR'))).companies.find(x=>x.tenantId===a)?.sites).toEqual([]);
  await q.query("SELECT set_config('app.tenant_id',$1,true)",[a]);expect((await q.query('SELECT role_key FROM memberships WHERE user_id=$1',[sup]))[0].role_key).toBe('SUPERVISOR');
 });
 it('rejects supervisors/guards, foreign companies and cross-company site IDs at service and database boundaries',async()=>{
  for(const actor of [user(sup,'SUPERVISOR'),user(guard,'GUARDIA')]) {
   await expect(auth.supervisionDirectory(actor)).rejects.toBeInstanceOf(ForbiddenException);
   await expect(auth.setSupervisionAccess(actor,{tenantId:a,supervisorId:sup,siteIds:[siteA2]})).rejects.toBeInstanceOf(ForbiddenException);
  }
  for(const args of [[c,sup,[siteC]],[b,sup,[siteC]],[a,guard,[siteA]]]){
   await q.query('SAVEPOINT denied');await q.query("SELECT set_config('app.user_id',$1,true)",[owner]);await expect(q.query('SELECT set_supervision_access($1,$2,$3::uuid[])',args)).rejects.toBeDefined();await q.query('ROLLBACK TO SAVEPOINT denied');
  }
  await q.query('SAVEPOINT supervisor_denied');await q.query("SELECT set_config('app.user_id',$1,true)",[sup]);await expect(q.query('SELECT supervision_access_directory()')).rejects.toBeDefined();await q.query('ROLLBACK TO SAVEPOINT supervisor_denied');
 });
 it('allows platform administrators to manage the directory and records their actual actor',async()=>{
  const directory=await auth.supervisionDirectory(user(platform,'SUPERADMIN',null)) as {companies:Array<{id:string}>};expect(directory.companies.some(x=>x.id===c)).toBe(true);
  await auth.setSupervisionAccess(user(platform,'SUPERADMIN',null),{tenantId:c,supervisorId:sup,siteIds:[siteC]});
  await q.query("SELECT set_config('app.tenant_id',$1,true)",[c]);const [audit]=await q.query("SELECT actor_id FROM audit_log WHERE action='supervisor.recintos_asignados' ORDER BY created_at DESC LIMIT 1");expect(audit.actor_id).toBe(platform);
 });
 it('switches only to an authorized membership and revokes only the requesting browser session',async()=>{
  const actor=user(owner,'ADMIN');const first=await auth.switchCompany(actor,a,'Browser one'),second=await auth.switchCompany({...actor,sid:randomUUID()},a,'Browser two');
  const jwt=new JwtService({secret:'fixture-only-secret-more-than-thirty-two-characters'}),claims=await jwt.verifyAsync(first.accessToken);
  const switched=await auth.switchCompany({...actor,sid:claims.sid},b,'Browser one');expect(switched.user.tenantId).toBe(b);expect(switched.user.role).toBe('ADMIN');expect(switched.user.id).toBe(owner);
  expect(await redis.get('auth:session:'+claims.sid)).toBeNull();expect(await auth.refresh(second.refreshToken)).toMatchObject({user:{id:owner,tenantId:a}});
  await expect(auth.switchCompany(actor,c,'Browser one')).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('fails closed without actor and exposes no PUBLIC function execution',async()=>{
  await q.query("SELECT set_config('app.user_id','',true)");expect(await q.query('SELECT * FROM staff_company_portfolio()')).toEqual([]);
  const [roles]=await q.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');expect(roles).toEqual({rolsuper:false,rolbypassrls:false});
  expect(await q.query(`SELECT proname FROM pg_proc p,LATERAL aclexplode(p.proacl) x WHERE proname IN('staff_company_portfolio','supervision_access_directory','set_supervision_access') AND x.grantee=0 AND x.privilege_type='EXECUTE'`)).toEqual([]);
 });
});
