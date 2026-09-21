import { SupportAccessService } from './support-access.service';
import type { DataSource } from 'typeorm';

const ds = (query: jest.Mock) => ({ query }) as unknown as DataSource;
const SUPER = 'super-1';

describe('SupportAccessService', () => {
  it('quien no es SUPERADMIN no abre accesos, aunque llegue al endpoint', async () => {
    const query = jest.fn().mockResolvedValueOnce([]); // sin platform_membership
    await expect(
      new SupportAccessService(ds(query)).open('otro-user', {
        tenantId: 't1',
        reason: 'revisar un incidente reportado',
      }),
    ).rejects.toThrow('Solo el SUPERADMIN abre accesos de soporte');
  });

  it('el motivo es obligatorio y sustantivo: no vale "ok"', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);
    await expect(
      new SupportAccessService(ds(query)).open(SUPER, { tenantId: 't1', reason: 'ok' }),
    ).rejects.toThrow('El motivo debe explicar el acceso');
  });

  it('la ventana se topa en 8 horas aunque pidan mas', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([
        { id: 'acc-1', tenant_id: 't1', tenant_name: 'Andina', reason: 'x', started_at: new Date(), expires_at: new Date() },
      ]);
    await new SupportAccessService(ds(query)).open(SUPER, {
      tenantId: 't1',
      reason: 'investigar por que no llegan las alertas',
      minutes: 99999,
    });
    const abrir = query.mock.calls.find(([sql]: [string]) =>
      sql.includes('platform_open_support_access'),
    );
    expect(abrir[1][3]).toBe(480); // 8 horas
  });

  it('abre por la funcion de plataforma y NO con SQL pelado (#109)', async () => {
    /*
     * `tenants` y `support_access_log` llevan RLS FORCE y la API se conecta con
     * un rol sujeto a ella: sin contexto de empresa —la situacion del
     * SUPERADMIN— un SELECT pelado no ve ni una fila y abrir respondia "La
     * empresa no existe". El mecanismo auditado quedo muerto meses.
     */
    const query = jest.fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([
        { id: 'acc-1', tenant_id: 't1', tenant_name: 'Andina', reason: 'x', started_at: new Date(), expires_at: new Date() },
      ]);
    await new SupportAccessService(ds(query)).open(SUPER, {
      tenantId: 't1',
      reason: 'revisar la ronda que reporto el cliente',
    });
    const sqls = query.mock.calls.map(([sql]: [string]) => sql);
    expect(sqls.some((sql) => sql.includes('platform_open_support_access'))).toBe(true);
    expect(sqls.some((sql) => /INSERT INTO\s+support_access_log/.test(sql))).toBe(false);
    expect(sqls.some((sql) => /FROM\s+tenants/.test(sql))).toBe(false);
  });

  it('no se abren dos ventanas a la misma empresa', async () => {
    // La guarda vive en la funcion: llega como unique_violation de PostgreSQL.
    const query = jest.fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockRejectedValueOnce(Object.assign(new Error('duplicada'), { code: '23505' }));
    await expect(
      new SupportAccessService(ds(query)).open(SUPER, {
        tenantId: 't1',
        reason: 'seguimiento del caso anterior',
      }),
    ).rejects.toThrow('Ya tienes un acceso de soporte abierto');
  });

  it('una empresa que no existe es 404 y no un 500', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockRejectedValueOnce(Object.assign(new Error('tenant not found'), { code: 'P0002' }));
    await expect(
      new SupportAccessService(ds(query)).open(SUPER, {
        tenantId: 'no-existe',
        reason: 'revisar un incidente reportado',
      }),
    ).rejects.toThrow('La empresa no existe');
  });

  it('resolve exige vigencia: vencido o cerrado no resuelve', async () => {
    // La vigencia la comprueba la funcion, que devuelve NULL cuando no aplica.
    const query = jest.fn().mockResolvedValue([{ tenant_id: null }]);
    await expect(
      new SupportAccessService(ds(query)).resolve('acc-1', SUPER),
    ).resolves.toBeNull();
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('platform_resolve_support_access');
  });

  it('resolve devuelve el tenant de la ventana vigente', async () => {
    const query = jest.fn().mockResolvedValue([{ tenant_id: 't1' }]);
    await expect(
      new SupportAccessService(ds(query)).resolve('acc-1', SUPER),
    ).resolves.toBe('t1');
  });

  it('cerrar un acceso ajeno o inexistente no hace nada silencioso', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([]);
    await expect(
      new SupportAccessService(ds(query)).close(SUPER, 'acc-ajeno'),
    ).rejects.toThrow('No hay un acceso abierto con ese id');
  });
});
