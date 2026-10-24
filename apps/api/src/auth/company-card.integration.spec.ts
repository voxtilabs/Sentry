import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const database = process.env.DATABASE_TEST_URL;
const describeDatabase = database ? describe : describe.skip;

describeDatabase('tarjeta de empresa con PostgreSQL y RLS reales', () => {
  let db: Client;
  let tenantA: string;
  let tenantB: string;
  let guardA: string;
  let platformActor: string;
  beforeAll(async () => { db = new Client({ connectionString: database }); await db.connect(); });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => {
    await db.query('BEGIN');
    tenantA = randomUUID(); tenantB = randomUUID(); guardA = randomUUID(); platformActor = randomUUID();
    for (const [id, card] of [[tenantA, 'AABB1234'], [tenantB, 'CCDD5678']]) {
      await db.query(`INSERT INTO tenants(id, slug, legal_name, display_name, login_card_uid)
        VALUES($1::uuid,$1::text,'Empresa de prueba','Empresa de prueba',$2)`, [id, card]);
    }
    for (const [id, tenant, role, active] of [[guardA, tenantA, 'GUARDIA', true],
      [randomUUID(), tenantA, 'GUARDIA', false], [randomUUID(), tenantA, 'ADMIN', true],
      [randomUUID(), tenantB, 'GUARDIA', true], [platformActor, null, 'SUPERADMIN', true]]) {
      await db.query(`INSERT INTO users(id, username, password_hash, given_name, family_name, is_active)
        VALUES($1::uuid,$1::text,'fixture-unusable','Persona','Prueba',$2)`, [id, active]);
      if (tenant) await db.query('INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,$3)', [tenant, id, role]);
      else await db.query('INSERT INTO platform_memberships(user_id,role_key) VALUES($1,$2)', [id, role]);
    }
  });
  afterEach(async () => { await db.query('ROLLBACK'); });

  it('con la tarjeta solo devuelve guardias activos de su empresa y ningún hash', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    const { rows } = await db.query('SELECT * FROM authenticate_company_card($1)', ['AABB1234']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: guardA, tenant_id: tenantA, role_key: 'GUARDIA', password_hash: '', nfc_pin_hash: null });
    expect((await db.query('SELECT * FROM authenticate_company_card($1)', ['DEADBEEF'])).rowCount).toBe(0);
    expect((await db.query('SELECT login_card_uid FROM tenants')).rowCount).toBe(0);
  });

  it('otra empresa no puede leer ni cambiar la tarjeta de A', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantB]);
    expect((await db.query('SELECT id FROM tenants WHERE id=$1', [tenantA])).rowCount).toBe(0);
    expect((await db.query('UPDATE tenants SET login_card_uid=NULL WHERE id=$1', [tenantA])).rowCount).toBe(0);
  });

  it('suspender la empresa o revocar la tarjeta invalida el ingreso', async () => {
    await db.query('UPDATE tenants SET status=$2 WHERE id=$1', [tenantA, 'suspended']);
    expect((await db.query('SELECT * FROM authenticate_company_card($1)', ['AABB1234'])).rowCount).toBe(0);
    await db.query('UPDATE tenants SET status=$2,login_card_uid=NULL WHERE id=$1', [tenantA, 'active']);
    expect((await db.query('SELECT * FROM authenticate_company_card($1)', ['AABB1234'])).rowCount).toBe(0);
  });

  it('solo un superadmin activo y declarado en el contexto puede configurar otra empresa', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.user_id',$1,true)", [guardA]);
    await db.query('SAVEPOINT forbidden_actor');
    await expect(db.query('SELECT platform_set_company_card($1,$2,$3)', [platformActor, tenantB, 'EEFF1234'])).rejects.toMatchObject({ code: '42501' });
    await db.query('ROLLBACK TO SAVEPOINT forbidden_actor');
    await db.query("SELECT set_config('app.user_id',$1,true)", [platformActor]);
    await db.query('SELECT platform_set_company_card($1,$2,$3)', [platformActor, tenantB, 'EEFF1234']);
    const result = await db.query('SELECT platform_get_company_card($1,$2) AS uid', [platformActor, tenantB]);
    expect(result.rows[0].uid).toBe('EEFF1234');
  });
});
