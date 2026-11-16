import { createHmac, randomInt } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { pepperDeCodigo } from './login-code';

export const COMPANY_CODE_LENGTH = 10;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateCompanyCode(): string {
  let code: string;
  do {
    code = Array.from({ length: COMPANY_CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  } while (!/[A-Z]/.test(code) || !/[0-9]/.test(code));
  return code;
}

/** Separado del código personal; la base nunca conserva la credencial legible. */
export function companyCodeLookup(code: string, pepper = pepperDeCodigo()): string {
  return createHmac('sha256', pepper).update(`company-access-code:v1:${code}`).digest('hex');
}

export async function companyCodeStatus(manager: EntityManager) {
  const rows = await manager.query<Array<{ configured: boolean; updatedAt: Date | null }>>(
    `SELECT login_access_code_hash IS NOT NULL AS configured, login_access_code_updated_at AS "updatedAt"
     FROM tenants WHERE id=app_tenant_id()`,
  );
  return rows[0] ?? { configured: false, updatedAt: null };
}

export async function renewCompanyCode(manager: EntityManager) {
  const code = generateCompanyCode();
  const rows = await manager.query<Array<{ updatedAt: Date }>>(
    `UPDATE tenants SET login_access_code_hash=$1, login_access_code_updated_at=now()
     WHERE id=app_tenant_id() RETURNING login_access_code_updated_at AS "updatedAt"`, [companyCodeLookup(code)],
  );
  if (!rows[0]) throw new ForbiddenException('No existe contexto de empresa');
  return { code, configured: true, updatedAt: rows[0].updatedAt };
}
