import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

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
});
