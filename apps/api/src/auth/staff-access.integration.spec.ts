import {randomUUID} from 'node:crypto';
import {DataSource,type QueryRunner} from 'typeorm';
import Redis from 'ioredis';
import {JwtService} from '@nestjs/jwt';
import {ForbiddenException} from '@nestjs/common';
import {argon2id,hash} from 'argon2';
import {AuthService} from './auth.service';
import type {MailService} from './mail.service';
import type {AuthenticatedUser} from './auth.guard';
import {PortfolioService} from '../dashboard/portfolio.service';
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
  auth=new AuthService({query:q.query.bind(q),transaction:async(fn:(manager:typeof q.manager)=>Promise<unknown>)=>fn(q.manager)} as unknown as DataSource,new JwtService({secret:'fixture-only-secret-more-than-thirty-two-characters'}),redis,{} as MailService);
 });
 afterEach(async()=>{await auth.revokeAllSessions(owner);await auth.revokeAllSessions(sup);await q.rollbackTransaction();await q.release();});
 it('shows only own companies and assigned sites, never passwords or foreign tenants',async()=>{
  const own=await auth.staffCompanies(user(owner,'ADMIN'));expect(own.companies.map(x=>x.tenantId).sort()).toEqual([a,b].sort());expect(own.companies.find(x=>x.tenantId===a)?.sites).toHaveLength(2);
  const restricted=await auth.staffCompanies(user(sup,'SUPERVISOR'));expect(restricted.companies).toHaveLength(1);expect(restricted.companies[0]?.sites.map(s=>s.id)).toEqual([siteA]);
  expect(JSON.stringify(own)).not.toContain('password');
  await expect(auth.staffCompanies(user(guard,'GUARDIA'))).rejects.toBeInstanceOf(ForbiddenException);await expect(auth.staffCompanies(user(platform,'SUPERADMIN',null))).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('abre una empresa autorizada en el acceso web del supervisor y conserva la selección explícita para la app',async()=>{
  const identity=sup+'@example.test';
  const password='solo-prueba-web-489';
  await q.query('RESET ROLE');
  await q.query('UPDATE users SET password_hash=$2 WHERE id=$1',[sup,await hash(password,{type:argon2id})]);
  await q.query("INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,'SUPERVISOR')",[b,sup]);
  await q.query('SET LOCAL ROLE sentrycore_app');

  await expect(auth.login({identity,password})).resolves.toMatchObject({requiresTenantSelection:true});
  const [first,second]=[a,b].sort();
  await expect(auth.login({identity,password,supervisorWeb:true})).resolves.toMatchObject({
   user:{id:sup,role:'SUPERVISOR',tenantId:first},
  });
  await expect(auth.login({identity,password,supervisorWeb:true,tenantId:second})).resolves.toMatchObject({
   user:{id:sup,role:'SUPERVISOR',tenantId:second},
  });
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
 it('consolida solo recintos autorizados del grupo con rondas, calidad y tareas históricas',async()=>{
  await q.query("SELECT set_config('app.user_id',$1,true)",[platform]);
  const [{id:group}]=await q.query("SELECT save_company_group(NULL,'Grupo de prueba',ARRAY[$1,$2]::uuid[]) AS id",[a,b]);
  const [{id:foreignGroup}]=await q.query("SELECT save_company_group(NULL,'Grupo ajeno',ARRAY[$1]::uuid[]) AS id",[c]);
  await q.query('SELECT assign_company_group_sites($1,$2,true,ARRAY[]::uuid[])',[group,sup]);
  expect((await auth.staffCompanies(user(sup,'SUPERVISOR'))).companies.find(company=>company.tenantId===b)?.sites.map(site=>site.id))
    .toEqual([siteB]);

  await q.query('RESET ROLE');
  await q.query("INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,'GUARDIA')",[b,guard]);
  for(const [tenant,site,status,compliance,voluntary] of [
   [a,siteA,'incompleta',50,true], [a,siteA2,'completada',100,false], [b,siteB,'vencida',null,false],
  ] as const) {
   const [route,point,patrol,template,item,secondItem]=Array.from({length:6},()=>randomUUID());
   await q.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
   await q.query("INSERT INTO routes(id,tenant_id,site_id,name,estimated_duration_min) VALUES($1,$2,$3,'Ruta',15)",[route,tenant,site]);
   await q.query("INSERT INTO checkpoints(id,tenant_id,site_id,name) VALUES($1,$2,$3,'Punto')",[point,tenant,site]);
   await q.query("INSERT INTO checklist_templates(id,tenant_id,site_id,name) VALUES($1,$2,$3,'Tareas')",[template,tenant,site]);
   await q.query(`INSERT INTO checklist_items(id,tenant_id,template_id,position,label,response_type,checkpoint_id)
     VALUES($1,$2,$3,1,'Foto','foto',$4),($5,$2,$3,2,'Pregunta','si_no',$4)`,[item,tenant,template,point,secondItem]);
   await q.query(`INSERT INTO patrols(id,tenant_id,site_id,route_id,guard_id,status,scheduled_start_at,scheduled_end_at,
     started_at,closed_at,expected_checkpoint_ids,compliance_pct,is_voluntary,checklist_template_id)
     VALUES($1,$2,$3,$4,$5,$6,'2026-11-10 13:00+00','2026-11-10 13:15+00',
      '2026-11-10 13:00+00','2026-11-10 13:15+00',$7::jsonb,$8,$9,$10)`,
   [patrol,tenant,site,route,guard,status,JSON.stringify([point]),compliance,voluntary,template]);
   if(site===siteA) {
    await q.query(`INSERT INTO scans(tenant_id,patrol_id,checkpoint_id,method,client_scan_id,latitude,longitude,accuracy_m,anomalies)
      VALUES($1,$2,$3,'nfc',$4,-33.4,-70.6,4,'["gps_impreciso"]')`,[tenant,patrol,point,randomUUID()]);
    await q.query("INSERT INTO checklist_responses(tenant_id,patrol_id,item_id,value,failed) VALUES($1,$2,$3,'no',true)",[tenant,patrol,secondItem]);
   }
  }

  await q.query('SET LOCAL ROLE sentrycore_app');
  await q.query("SELECT set_config('app.user_id',$1,true)",[platform]);
  await q.query('SELECT assign_company_group_sites($1,$2,false,ARRAY[$3,$4]::uuid[])',[group,sup,siteA,siteB]);
  const actualDb = {transaction:async (_isolation:string, work:(manager:typeof q.manager)=>Promise<unknown>)=>
    work({query:(sql:string, values?:unknown[])=>sql==='SET TRANSACTION READ ONLY'
      ? Promise.resolve([]) : q.query(sql,values)} as unknown as typeof q.manager)} as unknown as DataSource;
  const overview = new PortfolioService(actualDb);
  const date = {from:'2026-11-10',to:'2026-11-10'};
  const result = await overview.overview(user(sup,'SUPERVISOR'),date);
  expect(result.groups).toEqual([{id:group,name:'Grupo de prueba',companyIds:[a,b].sort()}]);
  expect(result.selected).toEqual({scope:'group',scopeId:group});
  expect(result.totals).toMatchObject({patrols:2,scheduled:1,voluntary:1,incomplete:1,expired:1,completed:0,
    compliancePct:50,scans:1,scansFlagged:1,scansWithGps:1,avgAccuracyM:4,tasksExpected:4,tasksDone:1,tasksFailed:1,taskPct:25});
  expect(result.sites.map(site=>site.siteId).sort()).toEqual([siteA,siteB].sort());
  expect(result.days[0]).toMatchObject({day:date.from,patrols:2});
  await expect(overview.overview(user(sup,'SUPERVISOR'),{...date,scope:'site',scopeId:siteA2})).rejects.toMatchObject({status:404});
  await expect(overview.overview(user(sup,'SUPERVISOR'),{...date,scope:'group',scopeId:foreignGroup})).rejects.toMatchObject({status:404});
  await q.query('SAVEPOINT denied_group');
  await expect(q.query("SELECT save_company_group(NULL,'Nombre prohibido','{}')")).rejects.toMatchObject({code:'42501'});
  await q.query('ROLLBACK TO SAVEPOINT denied_group');
  await q.query('SAVEPOINT denied_table');
  await expect(q.query('SELECT * FROM company_groups')).rejects.toMatchObject({code:'42501'});
  await q.query('ROLLBACK TO SAVEPOINT denied_table');
 });
});
