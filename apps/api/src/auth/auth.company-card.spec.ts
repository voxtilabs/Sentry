import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';

import { AuthService } from './auth.service';
import type { MailService } from './mail.service';
import type { AuthIdentityRow } from './auth.types';

const GUARD = { user_id: 'guard-a', tenant_id: 'tenant-a', tenant_name: 'Empresa A',
  tenant_slug: 'empresa-a', role_key: 'GUARDIA', guard_name: 'Guardia A' };

function setup() {
  const store = new Map<string, string>();
  const query = jest.fn().mockResolvedValue([GUARD]);
  const redis = { status: 'ready', get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    eval: jest.fn(async (script: string, _count: number, key: string, value: string) => {
      if (script.includes('INCR')) return 1;
      if (store.get(key) !== value) return 0;
      store.delete(key); return 1;
    }) };
  const auth = new AuthService({ query } as unknown as DataSource, {} as JwtService,
    redis as unknown as Redis, {} as MailService);
  const session = jest.spyOn(auth as unknown as {
    createSession: (guard: AuthIdentityRow, device: string) => Promise<unknown>;
  }, 'createSession').mockResolvedValue({ user: { id: GUARD.user_id, role: 'GUARDIA' } });
  return { auth, query, redis, session, store };
}

describe('tarjeta de empresa', () => {
  it('solo emite un permiso breve para elegir; no inicia sesión al leer la tarjeta', async () => {
    const { auth, redis, session } = setup();
    const picker = await auth.companyCard('aa:bb:12:34', 'ip-a', 'android-a');
    expect(picker.guards).toEqual([{ id: 'guard-a', name: 'Guardia A' }]);
    expect(session).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(expect.not.stringContaining(picker.ticket), expect.any(String), 'EX', 300);
  });
  it('elige un guardia de la misma empresa y consume el ticket una sola vez', async () => {
    const { auth, session } = setup();
    const { ticket } = await auth.companyCard('AABB1234', 'ip-a', 'android-a');
    await auth.selectCompanyGuard({ ticket, guardId: 'guard-a' }, 'ip-a', 'android-a');
    expect(session).toHaveBeenCalledWith(GUARD, 'android-a');
    await expect(auth.selectCompanyGuard({ ticket, guardId: 'guard-a' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rechaza otro guardia, otro dispositivo y un ticket vencido', async () => {
    const { auth, session, store } = setup();
    const { ticket } = await auth.companyCard('AABB1234', 'ip-a', 'android-a');
    await expect(auth.selectCompanyGuard({ ticket, guardId: 'guard-b' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.selectCompanyGuard({ ticket, guardId: 'guard-a' }, 'ip-b', 'android-b')).rejects.toBeInstanceOf(UnauthorizedException);
    store.clear();
    await expect(auth.selectCompanyGuard({ ticket, guardId: 'guard-a' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session).not.toHaveBeenCalled();
  });
  it('revalida la tarjeta y el guardia antes de crear la sesión', async () => {
    const { auth, query, session } = setup();
    const { ticket } = await auth.companyCard('AABB1234', 'ip-a', 'android-a');
    query.mockResolvedValue([]);
    await expect(auth.selectCompanyGuard({ ticket, guardId: 'guard-a' }, 'ip-a', 'android-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session).not.toHaveBeenCalled();
  });
});
