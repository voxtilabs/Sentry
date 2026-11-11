import type { DataSource } from 'typeorm';
import { RuntimeDatabaseSecurity } from './runtime-security';

describe('seguridad de la conexión real de la API', () => {
  it.each([true, undefined])('rechaza privilegios administrativos o rol desconocido (%s)', async (unsafe) => {
    const query = jest.fn().mockResolvedValue(unsafe === undefined ? [] : [{ unsafe }]);
    await expect(new RuntimeDatabaseSecurity({ query } as unknown as DataSource)
      .onApplicationBootstrap()).rejects.toThrow('rol PostgreSQL restringido');
  });
  it('rechaza una tabla tenant que perdió FORCE RLS', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ unsafe: false }]).mockResolvedValueOnce([{ relname: 'scans' }]);
    await expect(new RuntimeDatabaseSecurity({ query } as unknown as DataSource)
      .onApplicationBootstrap()).rejects.toThrow('RLS habilitado y forzado');
  });
  it('acepta la aplicación restringida y las tablas protegidas', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ unsafe: false }]).mockResolvedValueOnce([]);
    await expect(new RuntimeDatabaseSecurity({ query } as unknown as DataSource)
      .onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
