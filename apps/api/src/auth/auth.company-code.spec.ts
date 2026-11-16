import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';

import { AuthService } from './auth.service';
import type { AuthIdentityRow } from './auth.types';
import type { MailService } from './mail.service';
import { companyCodeLookup } from './company-code';

const GUARD = { user_id: 'guard-a', tenant_id: 'tenant-a', tenant_name: 'Empresa A',
  tenant_slug: 'empresa-a', role_key: 'GUARDIA', guard_name: 'Usuario de prueba' };

function setup() {
  const store = new Map<string, string>();
  const query = jest.fn().mockResolvedValue([GUARD]);
  const managerQuery = jest.fn(async (sql: string) => {
    if (sql.includes('FROM users u')) return [{ id: GUARD.user_id }];
    if (sql.includes('trim(u.given_name')) return [GUARD];
    return [];
  });
  const redis = { status: 'ready', get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    del: jest.fn(async (key: string) => store.delete(key)),
    eval: jest.fn(async (script: string, _count: number, key: string, value: string): Promise<number> => {
      if (script.includes('INCR')) return 1;
      if (store.get(key) !== value) return 0;
      store.delete(key); return 1;
    }) };
  const auth = new AuthService({ query, transaction: (fn: (m: unknown) => Promise<unknown>) => fn({ query: managerQuery }) } as unknown as DataSource,
    {} as JwtService, redis as unknown as Redis, {} as MailService);
  const session = jest.spyOn(auth as unknown as { createSession: (g: AuthIdentityRow, d: string) => Promise<unknown> }, 'createSession')
    .mockResolvedValue({ user: { id: GUARD.user_id, role: 'GUARDIA' } });
  const revoke = jest.spyOn(auth as unknown as { revokeFamily: (id: string) => Promise<void> }, 'revokeFamily').mockResolvedValue();
  return { auth, query, redis, session, revoke, store };
}

describe('ingreso de empresa por código y relevo', () => {
  const originalPepper = process.env.LOGIN_CODE_PEPPER;
  beforeAll(() => { process.env.LOGIN_CODE_PEPPER = 'test-only-company-code-pepper-with-40-characters'; });
  afterAll(() => { if (originalPepper === undefined) delete process.env.LOGIN_CODE_PEPPER; else process.env.LOGIN_CODE_PEPPER = originalPepper; });

  it('solo abre el selector, sin emitir todavía sesión de guardia o de supervisor', async () => {
    const { auth, query, store, session } = setup();
    const picker = await auth.companyCode('ABCD1234EF', 'ip-a', 'android-a');
    expect(picker.guards).toEqual([{ id: GUARD.user_id, name: GUARD.guard_name }]);
    expect(session).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('SELECT * FROM authenticate_company_code($1)', [companyCodeLookup('ABCD1234EF')]);
    expect(JSON.stringify([...store])).not.toContain('ABCD1234EF');
  });
  it('elige únicamente un guardia permitido y consume el ticket una sola vez', async () => {
    const { auth, session } = setup();
    const picker = await auth.companyCode('ABCD1234EF', 'ip-a', 'android-a');
    await expect(auth.selectCompanyGuard({ ticket: picker.ticket, guardId: 'guard-b' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
    await auth.selectCompanyGuard({ ticket: picker.ticket, guardId: 'guard-a' }, 'ip-a', 'android-a');
    expect(session).toHaveBeenCalledTimes(1);
    await expect(auth.selectCompanyGuard({ ticket: picker.ticket, guardId: 'guard-a' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('cambiar el código, suspender la empresa o retirar al guardia invalida el selector ya abierto', async () => {
    const { auth, query, session } = setup();
    const picker = await auth.companyCode('ABCD1234EF', 'ip-a', 'android-a');
    query.mockResolvedValue([]);
    await expect(auth.companyPicker(picker.contextToken, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.selectCompanyGuard({ ticket: picker.ticket, guardId: 'guard-a' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session).not.toHaveBeenCalled();
  });
  it('otro teléfono no puede reutilizar la continuación de empresa', async () => {
    const { auth } = setup();
    const picker = await auth.companyCode('ABCD1234EF', 'ip-a', 'android-a');
    await expect(auth.companyPicker(picker.contextToken, 'ip-b', 'android-b')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('aplica su propio límite sin consultar empresas ni gastar intentos de contraseña', async () => {
    const { auth, redis, query } = setup();
    redis.eval.mockResolvedValueOnce(11);
    await expect(auth.companyCode('ABCD1234EF', 'ip-a', 'android-a')).rejects.toBeInstanceOf(HttpException);
    expect(query).not.toHaveBeenCalled();
    expect(redis.eval.mock.calls[0]?.[2]).toMatch(/^auth:company-code-rate:[a-f0-9]{64}$/);
  });
  it('al terminar jornada mantiene la procedencia del código para poder revocarla después', async () => {
    const { auth, query, revoke } = setup();
    const picker = await auth.companyCode('ABCD1234EF', 'ip-a', 'android-a');
    const next = await auth.endGuardDay({ sub: 'guard-a', tenant_id: 'tenant-a', role: 'GUARDIA', sid: 'family-a' }, 'android-a', picker.contextToken);
    expect(next).toBeTruthy();
    expect(revoke).toHaveBeenCalledWith('family-a');
    query.mockResolvedValue([]);
    await expect(auth.companyPicker(next!, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('un código retirado permite terminar jornada pero exige identificar de nuevo la empresa', async () => {
    const { auth, query, revoke } = setup();
    const picker = await auth.companyCode('ABCD1234EF', 'ip-a', 'android-a');
    query.mockResolvedValue([]);
    expect(await auth.endGuardDay({ sub: 'guard-a', tenant_id: 'tenant-a', role: 'GUARDIA', sid: 'family-a' }, 'android-a', picker.contextToken)).toBeNull();
    expect(revoke).toHaveBeenCalledWith('family-a');
  });
});
