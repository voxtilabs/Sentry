import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { EntityManager } from 'typeorm';

import { companyCodeLookup, companyCodeStatus, renewCompanyCode } from './company-code';

const database = process.env.DATABASE_TEST_URL;
const conBase = database ? describe : describe.skip;

conBase('código de empresa con PostgreSQL, actor y RLS reales', () => {
  let db: Client;
  let tenantA: string, tenantB: string, guardA: string, actor: string;
  const codeA = 'ABCD1234EF', codeB = 'ZYXW9876VU';
  const originalPepper = process.env.LOGIN_CODE_PEPPER;
  beforeAll(async () => {
    process.env.LOGIN_CODE_PEPPER = randomBytes(32).toString('hex');
    db = new Client({ connectionString: database }); await db.connect();
  });
  afterAll(async () => {
    await db.end();
    if (originalPepper === undefined) delete process.env.LOGIN_CODE_PEPPER; else process.env.LOGIN_CODE_PEPPER = originalPepper;
  });
  beforeEach(async () => {
    await db.query('BEGIN');
    tenantA = randomUUID(); tenantB = randomUUID(); guardA = randomUUID(); actor = randomUUID();
    for (const [id, code] of [[tenantA, codeA], [tenantB, codeB]]) {
      await db.query(`INSERT INTO tenants(id,slug,legal_name,display_name,login_access_code_hash)
        VALUES($1::uuid,$1::text,'Prueba','Empresa',$2)`, [id, companyCodeLookup(code!)]);
    }
    for (const [id, tenant, role, active] of [[guardA, tenantA, 'GUARDIA', true],
      [randomUUID(), tenantA, 'GUARDIA', false], [randomUUID(), tenantA, 'ADMIN', true],
      [randomUUID(), tenantA, 'SUPERVISOR', true], [randomUUID(), tenantB, 'GUARDIA', true], [actor, null, 'SUPERADMIN', true]]) {
      await db.query(`INSERT INTO users(id,username,password_hash,given_name,family_name,is_active)
        VALUES($1::uuid,$1::text,'unusable-test-hash','Usuario','Prueba',$2)`, [id, active]);
      if (tenant) await db.query('INSERT INTO memberships(tenant_id,user_id,role_key) VALUES($1,$2,$3)', [tenant, id, role]);
      else await db.query('INSERT INTO platform_memberships(user_id,role_key) VALUES($1,$2)', [id, role]);
    }
  });
  afterEach(async () => { await db.query('ROLLBACK'); });

  it('resuelve solo guardias activos de la empresa sin contraseñas ni roles privilegiados', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    const { rows } = await db.query('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup(codeA)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: guardA, tenant_id: tenantA, role_key: 'GUARDIA', password_hash: '', nfc_pin_hash: null });
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', ['0'.repeat(64)])).rowCount).toBe(0);
    expect((await db.query('SELECT login_access_code_hash FROM tenants')).rows).toEqual([]);
  });

  it('otra empresa no puede ver ni reemplazar el código de A', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantB]);
    expect((await db.query('SELECT id FROM tenants WHERE id=$1', [tenantA])).rowCount).toBe(0);
    expect((await db.query('UPDATE tenants SET login_access_code_hash=NULL WHERE id=$1', [tenantA])).rowCount).toBe(0);
  });

  it('renueva solo la empresa del contexto, devuelve el código una vez y conserva únicamente el HMAC', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
    const manager = { query: async (sql: string, args?: unknown[]) => (await db.query(sql, args)).rows } as EntityManager;
    const generated = await renewCompanyCode(manager);
    expect(generated.code).toMatch(/^[A-Z0-9]{10}$/);
    expect(await companyCodeStatus(manager)).toMatchObject({ configured: true });
    expect(await companyCodeStatus(manager)).not.toHaveProperty('code');
    const stored = await db.query('SELECT login_access_code_hash FROM tenants');
    expect(stored.rows[0].login_access_code_hash).toBe(companyCodeLookup(generated.code));
    expect(stored.rows[0].login_access_code_hash).not.toContain(generated.code);
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup(codeA)])).rowCount).toBe(0);
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup(generated.code)])).rowCount).toBe(1);
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup(codeB)])).rowCount).toBe(1);
  });

  it('suspender la empresa o desactivar al guardia impide el acceso', async () => {
    await db.query('UPDATE tenants SET status=$2 WHERE id=$1', [tenantA, 'suspended']);
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup(codeA)])).rowCount).toBe(0);
    await db.query('UPDATE tenants SET status=$2 WHERE id=$1', [tenantA, 'active']);
    await db.query('UPDATE users SET is_active=false WHERE id=$1', [guardA]);
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup(codeA)])).rowCount).toBe(0);
  });

  it('la función de plataforma exige al superadmin real declarado en el contexto y registra la renovación', async () => {
    await db.query('SET LOCAL ROLE sentrycore_app');
    await db.query("SELECT set_config('app.user_id',$1,true)", [guardA]);
    await db.query('SAVEPOINT denied');
    await expect(db.query('SELECT platform_set_company_code($1,$2,$3)', [actor, tenantB, 'a'.repeat(64)])).rejects.toMatchObject({ code: '42501' });
    await db.query('ROLLBACK TO SAVEPOINT denied');
    await db.query("SELECT set_config('app.user_id',$1,true)", [actor]);
    await db.query('SELECT platform_set_company_code($1,$2,$3)', [actor, tenantB, 'a'.repeat(64)]);
    expect((await db.query('SELECT configured FROM platform_company_code_status($1,$2)', [actor, tenantB])).rows[0].configured).toBe(true);
    expect((await db.query('SELECT * FROM authenticate_company_code($1)', ['a'.repeat(64)])).rows[0].tenant_id).toBe(tenantB);
    await db.query('RESET ROLE');
    expect((await db.query(`SELECT action FROM platform_audit_log WHERE tenant_id=$1 AND actor_user_id=$2`, [tenantB, actor])).rows)
      .toEqual([{ action: 'tenant.company_code_updated' }]);
  });
});
