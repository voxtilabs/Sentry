import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { DEFAULT_PATROL_RULES } from '@sentrycore/shared';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import { RulesService } from '../rules/rules.service';
import { GpsPolicyService } from '../geo/gps-policy.service';
import type { AuthenticatedUser } from '../auth/auth.guard';
import type { AuditService } from '../audit/audit.service';
import { CompanyContext } from '../auth/company-context';
import type Redis from 'ioredis';
import { ReferenceService } from './reference.service';
import type { ReferencePointDto } from './reference.dto';
const describeDb=process.env.DATABASE_TEST_URL?describe:describe.skip;
describeDb('ronda patrón y relevo con PostgreSQL/RLS reales',()=>{
  let db:DataSource,q:QueryRunner,ctx:TenantContextService,service:ReferenceService;
  let tenant:string,otherTenant:string,site:string,route:string,user:AuthenticatedUser,guard:string,walk:string;
  let points:string[],uids:string[];
  const policy=jest.fn(),rules={effective:jest.fn(async()=>DEFAULT_PATROL_RULES)} as unknown as RulesService;
  beforeAll(async()=>{db=await new DataSource({type:'postgres',url:process.env.DATABASE_TEST_URL,entities:[]}).initialize()});
  afterAll(async()=>{await db.destroy()});
  beforeEach(async()=>{
    q=db.createQueryRunner();await q.connect();await q.startTransaction();
    tenant=randomUUID();otherTenant=randomUUID();site=randomUUID();route=randomUUID();guard=randomUUID();
    user={sub:randomUUID(),tenant_id:tenant,role:'SUPERVISOR',sid:randomUUID()};points=[randomUUID(),randomUUID()];uids=points.map(()=>randomUUID().replaceAll('-','').toUpperCase());
    for(const id of [tenant,otherTenant])await q.query("INSERT INTO tenants(id,slug,legal_name,display_name) VALUES($1::uuid,$1::text,'Prueba','Prueba')",[id]);
    await q.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
    for(const [id,role]of [[user.sub,'SUPERVISOR'],[guard,'GUARDIA']]){
      await q.query("INSERT INTO users(id,username,password_hash,given_name,family_name) VALUES($1::uuid,$1::text,'unusable','Prueba','Prueba')",[id]);
      await q.query('INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,$3)',[tenant,id,role]);
    }
    await q.query("INSERT INTO sites(id,tenant_id,name,branch_name,address) VALUES($1,$2,'Sitio','Sucursal','Dirección')",[site,tenant]);
    await q.query('INSERT INTO supervisor_sites(tenant_id,supervisor_id,site_id) VALUES($1,$2,$3)',[tenant,user.sub,site]);
    await q.query("INSERT INTO routes(id,tenant_id,site_id,name,estimated_duration_min) VALUES($1,$2,$3,'Ruta',15)",[route,tenant,site]);
    for(let i=0;i<2;i++){
      await q.query("INSERT INTO checkpoints(id,tenant_id,site_id,name) VALUES($1,$2,$3,'Punto')",[points[i],tenant,site]);
      await q.query('INSERT INTO route_checkpoints(tenant_id,route_id,checkpoint_id,position) VALUES($1,$2,$3,$4)',[tenant,route,points[i],i+1]);
      await q.query('INSERT INTO tags(tenant_id,checkpoint_id,uid) VALUES($1,$2,$3)',[tenant,points[i],uids[i]]);
    }
    await q.query('SET LOCAL ROLE sentrycore_app');ctx=new TenantContextService();
    policy.mockResolvedValue({consent:{granted:true}});
    service=new ReferenceService(ctx,new SupervisorService(ctx,rules,{} as AuditService),{policy} as unknown as GpsPolicyService,rules);
    walk=await ctx.run(q,tenant,async()=> (await service.start(route,user)).id);
  });
  afterEach(async()=>{await q.rollbackTransaction();await q.release()});
  const sample=():ReferencePointDto=>({clientPointId:randomUUID(),recordedAt:new Date().toISOString(),latitude:-33.4,longitude:-70.6,accuracyM:3,
    stationary:true,accelSamples:200,gyroSamples:200,satellitesUsed:12,speedMps:0,accelRmsG:0.01,gyroRmsRadS:0.01});
  it('guarda etiquetas en orden y calcula una coordenada distinta por punto antes de finalizar',async()=>ctx.run(q,tenant,async()=>{
    const now=Date.now();
    const p={...sample(),recordedAt:new Date(now-4000).toISOString()};
    const next={...sample(),recordedAt:new Date(now+4000).toISOString(),latitude:-33.4004,longitude:-70.6003};
    const poor={...next,clientPointId:randomUUID(),accuracyM:DEFAULT_PATROL_RULES.referenceGpsTargetAccuracyM+10};
    await service.samples(walk,[p,poor],user);
    await service.samples(walk,[p,poor],user);
    for(const [i,uid] of uids.entries()){
      const scan={uid,clientScanId:randomUUID(),scannedAt:i===0?p.recordedAt:next.recordedAt};
      await service.scan(walk,scan,user);
      await service.scan(walk,scan,user);
    }
    await expect(service.finish(walk,user)).rejects.toBeInstanceOf(ConflictException);
    await service.samples(walk,[next],user);
    const finished=await service.finish(walk,user);
    expect(finished.walk.status).toBe('completed');
    expect(finished.points).toHaveLength(3);
    expect(await q.query('SELECT checkpoint_id FROM reference_scans WHERE walk_id=$1 ORDER BY scanned_at',[walk]))
      .toEqual(points.map(checkpoint_id=>({checkpoint_id})));
    for(const [i,expected] of [p,next].entries()){
      const checkpoint=finished.checkpoints[i];
      expect(checkpoint).toMatchObject({id:points[i],position:i+1,scans:1,estimate:{accuracyM:3,stationary:true}});
      expect(checkpoint?.estimate?.latitude).toBeCloseTo(expected.latitude,6);
      expect(checkpoint?.estimate?.longitude).toBeCloseTo(expected.longitude,6);
    }
    expect(await q.query('SELECT latitude,longitude FROM checkpoints WHERE id=$1',[points[0]])).toEqual([{latitude:null,longitude:null}]);
    await expect(service.samples(walk,[sample()],user)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.samples(walk,[p],user)).resolves.toEqual({acknowledged:[p.clientPointId]});
  }));
  it('rechaza otro supervisor, otro tenant, recinto no asignado y guardia',async()=>ctx.run(q,tenant,async()=>{
    await expect(service.detail(walk,{...user,sub:guard})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.detail(walk,{...user,role:'GUARDIA'})).rejects.toBeInstanceOf(ForbiddenException);
    await q.query('DELETE FROM supervisor_sites WHERE supervisor_id=$1',[user.sub]);
    await expect(service.detail(walk,user)).rejects.toBeInstanceOf(ForbiddenException);
    await q.query("SELECT set_config('app.tenant_id',$1,true)",[otherTenant]);
    expect(await q.query('SELECT id FROM reference_walks WHERE id=$1',[walk])).toHaveLength(0);
    await expect(service.detail(walk,user)).rejects.toBeInstanceOf(NotFoundException);
  }));
  it('rechaza cierre incompleto, tarjeta ajena y muestras fuera de ventana',async()=>ctx.run(q,tenant,async()=>{
    await expect(service.finish(walk,user)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.samples(walk,[{...sample(),recordedAt:'2000-01-01T00:00:00Z'}],user)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.scan(walk,{uid:'DEADBEEF',clientScanId:randomUUID(),scannedAt:new Date().toISOString()},user)).rejects.toBeInstanceOf(ConflictException);
    expect((await service.finish(walk,user,true)).walk.status).toBe('cancelled');
  }));
  it('el rol real no puede modificar o borrar muestras originales',async()=>ctx.run(q,tenant,async()=>{
    await service.samples(walk,[sample()],user);
    for(const sql of ['DELETE FROM reference_samples','UPDATE reference_samples SET point=point','DELETE FROM reference_walks']){
      await q.query('SAVEPOINT denied');await expect(q.query(sql)).rejects.toMatchObject({code:'42501'});await q.query('ROLLBACK TO SAVEPOINT denied');
    }
  }));
  it('solo permite relevo de guardias activos de la empresa autenticada',async()=>{
    const contexts=new CompanyContext({transaction:async (fn:(manager:typeof q.manager)=>unknown)=>fn(q.manager)} as unknown as DataSource,{} as Redis);
    expect((await contexts.tenantGuards(tenant,guard,true)).map(g=>g.user_id)).toEqual([guard]);
    await expect(contexts.tenantGuards(tenant,user.sub,true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(contexts.tenantGuards(otherTenant,guard,true)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
