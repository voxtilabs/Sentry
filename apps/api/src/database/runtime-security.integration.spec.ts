import { DataSource } from 'typeorm';
import { RuntimeDatabaseSecurity } from './runtime-security';

const describeDb = process.env.DATABASE_TEST_URL && process.env.DATABASE_APP_TEST_URL ? describe : describe.skip;
describeDb('endurecimiento contra PostgreSQL real', () => {
  let admin: DataSource, app: DataSource;
  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: process.env.DATABASE_TEST_URL }).initialize();
    app = await new DataSource({ type: 'postgres', url: process.env.DATABASE_APP_TEST_URL }).initialize();
  });
  afterAll(async () => { await app?.destroy(); await admin?.destroy(); });
  it('acepta RLS restringido y rechaza arrancar la API como administrador', async () => {
    await expect(new RuntimeDatabaseSecurity(app).onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(new RuntimeDatabaseSecurity(admin).onApplicationBootstrap()).rejects.toThrow('rol PostgreSQL restringido');
  });
  it('ninguna función SECURITY DEFINER del negocio concede EXECUTE a PUBLIC', async () => {
    const rows = await admin.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef AND EXISTS (SELECT 1
        FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE')`);
    expect(rows).toEqual([]);
    await expect(app.query('SELECT * FROM rondas_abandonadas(25,1)')).resolves.toBeDefined();
  });
});
