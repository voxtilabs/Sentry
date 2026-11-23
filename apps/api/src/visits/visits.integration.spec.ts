import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { VehicleLookupProcessor } from './vehicle-lookup.jobs';
import { emptyVehicleCheck, type VehicleRegistryService } from './vehicle-registry.service';
import { VisitsService } from './visits.service';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';

const database=process.env.DATABASE_TEST_URL;
const describeDatabase=database?describe:describe.skip;
describeDatabase('visitas con PostgreSQL real: aislamiento, privilegios e idempotencia',()=>{
  let db:Client;let tenantA:string;let tenantB:string;let guard:string;let site:string;
  beforeAll(async()=>{db=new Client({connectionString:database});await db.connect();});
  afterAll(async()=>{await db.end();});
  beforeEach(async()=>{
    await db.query('BEGIN');tenantA=randomUUID();tenantB=randomUUID();guard=randomUUID();site=randomUUID();
    for(const tenant of [tenantA,tenantB]) await db.query("INSERT INTO tenants(id,slug,legal_name,display_name) VALUES($1::uuid,$1::text,'Fixture','Fixture')",[tenant]);
    await db.query("INSERT INTO users(id,username,password_hash,given_name,family_name) VALUES($1::uuid,$1::text,'unusable','Persona','Prueba')",[guard]);
    await db.query("INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,'GUARDIA')",[tenantA,guard]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantA]);
    await db.query("INSERT INTO sites(id,tenant_id,name,branch_name,address) VALUES($1,$2,'Recinto','Prueba','Dirección ficticia')",[site,tenantA]);
    await db.query('SET LOCAL ROLE sentrycore_app');
  });
  afterEach(async()=>{await db.query('ROLLBACK');});
  async function insert(client=randomUUID(),extra='') {
    return db.query(`INSERT INTO visitor_sessions(tenant_id,site_id,guard_id,client_visit_id,given_names,family_names,run,entered_at_device,arrives_in_vehicle,notice_version)
      VALUES(app_tenant_id(),$1,$2,$3,'Nombre','Apellido','12345678-5',now(),false,'fixture') ${extra} RETURNING id`,[site,guard,client]);
  }
  it('sin tenant no hay lectura ni posibilidad de insertar',async()=>{
    await insert();await db.query("SELECT set_config('app.tenant_id','',true)");
    expect((await db.query('SELECT id FROM visitor_sessions')).rowCount).toBe(0);
    await expect(insert()).rejects.toMatchObject({code:'42501'});
  });
  it('B no puede leer datos ni asociar una visita a un recinto de A',async()=>{
    await insert();await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantB]);
    expect((await db.query('SELECT id FROM visitor_sessions')).rowCount).toBe(0);
    await expect(insert()).rejects.toMatchObject({code:'23503'});
  });
  it('el mismo identificador offline no duplica el ingreso',async()=>{
    const id=randomUUID();await insert(id);
    expect((await insert(id,'ON CONFLICT(tenant_id,guard_id,client_visit_id) DO NOTHING')).rowCount).toBe(0);
  });
  it('el RUN solo recupera ingresos abiertos del recinto autorizado',async()=>{
    await db.query('RESET ROLE');
    await db.query('INSERT INTO guard_sites(tenant_id,site_id,guard_id) VALUES($1,$2,$3)',[tenantA,site,guard]);
    await db.query('SET LOCAL ROLE sentrycore_app');
    const open=await insert();
    const closed=await insert();
    await db.query('UPDATE visitor_sessions SET exited_at_device=now(),exited_at_server=now(),exit_guard_id=$1 WHERE id=$2',[guard,closed.rows[0].id]);
    const service=new VisitsService({
      tenantId:tenantA,
      manager:{query:async(sql:string,args:unknown[])=>(await db.query(sql,args)).rows},
    } as unknown as TenantContextService,{effective:async()=>({visitorRetentionDays:30})} as RulesService,
    {} as ConstructorParameters<typeof VisitsService>[2],{} as ConstructorParameters<typeof VisitsService>[3]);
    expect(await service.findExit(guard,{siteId:site,run:'12.345.678-5'})).toMatchObject([{id:open.rows[0].id,run:'12345678-5',exitedAt:null}]);
    await expect(service.findExit(guard,{siteId:randomUUID(),run:'12345678-5'})).rejects.toThrow('No tienes acceso');
    await db.query('UPDATE visitor_sessions SET exited_at_device=now(),exited_at_server=now(),exit_guard_id=$1 WHERE id=$2',[guard,open.rows[0].id]);
    expect(await service.returningVisitor(guard,{siteId:site,run:'12.345.678-5'})).toEqual({visitor:{givenNames:'Nombre',familyNames:'Apellido'}});
    await expect(service.returningVisitor(guard,{siteId:randomUUID(),run:'12345678-5'})).rejects.toThrow('No tienes acceso');
    expect(await service.listAll(guard,'GUARDIA')).toHaveLength(2);
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantB]);
    await expect(service.returningVisitor(guard,{siteId:site,run:'12345678-5'})).rejects.toThrow('No tienes acceso');
    expect(await service.listAll(guard,'GUARDIA')).toEqual([]);
  });
  it('no permite editar la identidad ni borrar un ingreso',async()=>{
    await insert();
    for(const sql of ["UPDATE visitor_sessions SET run='11111111-1'",'DELETE FROM visitor_sessions']) {
      await db.query('SAVEPOINT denied');await expect(db.query(sql)).rejects.toMatchObject({code:'42501'});await db.query('ROLLBACK TO SAVEPOINT denied');
    }
    await db.query('UPDATE visitor_sessions SET exited_at_device=now(),exited_at_server=now(),exit_guard_id=$1',[guard]);
  });
  it('el rol aplicación no dispone de columnas para imagen, serial o texto OCR',async()=>{
    const {rows}=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='visitor_sessions'");
    expect(rows.map(r=>r.column_name)).not.toEqual(expect.arrayContaining(['document_number','image','raw_text']));
    expect(rows.some(r=>/document_number|raw_text|photo|image|birth/.test(r.column_name))).toBe(false);
  });
  it('la purga normal solo elimina visitas vencidas de la empresa solicitada',async()=>{
    await db.query('RESET ROLE');await insert();
    await db.query("UPDATE visitor_sessions SET created_at=now()-interval '31 days'");
    await db.query('SET LOCAL ROLE sentrycore_app');await db.query("SELECT set_config('app.tenant_id','',true)");
    const {rows}=await db.query('SELECT retencion_purgar_visitas($1,30,5000) AS deleted',[tenantA]);
    expect(rows[0].deleted).toBe(1);
  });
  it('el resultado de servidor se añade sin editar la evidencia inicial y no se duplica al reintentar',async()=>{
    const requestId=randomUUID();const resultId=randomUUID();
    const pending={...emptyVehicleCheck(),lookupPending:true,lookupResultId:resultId};
    await db.query('INSERT INTO visitor_vehicle_checks(id,tenant_id,site_id,guard_id,plate,result) VALUES($1,app_tenant_id(),$2,$3,$4,$5)',
      [requestId,site,guard,'ABCD12',pending]);
    const database={transaction:async(operation:(manager:unknown)=>Promise<unknown>)=>operation({query:db.query.bind(db)})} as unknown as DataSource;
    const processor=new VehicleLookupProcessor(database,{} as VehicleRegistryService);
    const job={tenantId:tenantA,actorId:guard,lookupId:requestId,resultId,plate:'ABCD12'};
    const complete={...emptyVehicleCheck(),make:'MARCA',model:'MODELO',lookupPending:false};
    await processor.finish(job,complete);await processor.finish(job,complete);
    const rows=(await db.query('SELECT id,result FROM visitor_vehicle_checks ORDER BY created_at,id')).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find(row=>row.id===requestId).result).toEqual(pending);
    expect(rows.find(row=>row.id===resultId).result).toMatchObject({make:'MARCA',lookupPending:false});
    await db.query('SAVEPOINT immutable');
    await expect(db.query('UPDATE visitor_vehicle_checks SET result=$1 WHERE id=$2',[complete,requestId])).rejects.toMatchObject({code:'42501'});
    await db.query('ROLLBACK TO SAVEPOINT immutable');
  });
  it('un job en contexto B no puede completar ni leer la consulta de A',async()=>{
    const id=randomUUID();const resultId=randomUUID();
    await db.query('INSERT INTO visitor_vehicle_checks(id,tenant_id,site_id,guard_id,plate,result) VALUES($1,app_tenant_id(),$2,$3,$4,$5)',
      [id,site,guard,'ABCD12',{...emptyVehicleCheck(),lookupPending:true}]);
    const database={transaction:async(operation:(manager:unknown)=>Promise<unknown>)=>operation({query:db.query.bind(db)})} as unknown as DataSource;
    const processor=new VehicleLookupProcessor(database,{} as VehicleRegistryService);
    await processor.finish({tenantId:tenantB,actorId:guard,lookupId:id,resultId,plate:'ABCD12'},emptyVehicleCheck());
    expect((await db.query('SELECT id FROM visitor_vehicle_checks')).rows).toHaveLength(0);
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantA]);
    expect((await db.query('SELECT id FROM visitor_vehicle_checks')).rows.map(row=>row.id)).toEqual([id]);
  });
  it('la retención conserva el resultado asíncrono hasta que vence la visita que lo utiliza',async()=>{
    const initial=randomUUID();const final=randomUUID();
    await db.query('INSERT INTO visitor_vehicle_checks(id,tenant_id,site_id,guard_id,plate,result) VALUES($1,app_tenant_id(),$3,$4,$5,$6),($2,app_tenant_id(),$3,$4,$5,$7)',
      [initial,final,site,guard,'ABCD12',{lookupPending:true,lookupResultId:final},{make:'MARCA',lookupPending:false}]);
    await db.query(`INSERT INTO visitor_sessions(tenant_id,site_id,guard_id,client_visit_id,given_names,family_names,run,entered_at_device,arrives_in_vehicle,plate,vehicle_check_id,notice_version)
      VALUES(app_tenant_id(),$1,$2,$3,'Nombre','Apellido','12345678-5',now(),true,'ABCD12',$4,'fixture')`,[site,guard,randomUUID(),initial]);
    await db.query('RESET ROLE');
    await db.query("UPDATE visitor_vehicle_checks SET created_at=now()-interval '31 days'");
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.tenant_id','',true)");
    await db.query('SELECT retencion_purgar_visitas($1,30,5000)',[tenantA]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantA]);
    expect((await db.query('SELECT id FROM visitor_vehicle_checks')).rows).toHaveLength(2);
    await db.query('RESET ROLE');
    await db.query("UPDATE visitor_sessions SET created_at=now()-interval '31 days'");
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.tenant_id','',true)");
    await db.query('SELECT retencion_purgar_visitas($1,30,5000)',[tenantA]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantA]);
    expect((await db.query('SELECT id FROM visitor_vehicle_checks')).rows).toHaveLength(0);
  });
});
