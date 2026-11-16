import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export async function readCompanyCard(manager: EntityManager) {
  const rows = await manager.query<Array<{ card_uid: string | null }>>(
    'SELECT login_card_uid AS card_uid FROM tenants WHERE id = app_tenant_id()',
  );
  if (!rows[0]) throw new ForbiddenException('Sin contexto de empresa');
  return { cardUid: rows[0].card_uid };
}

export async function writeCompanyCard(manager: EntityManager, cardUid: string) {
  try {
    const rows = await manager.query<Array<{ id: string }>>(
      `UPDATE tenants SET login_card_uid = NULLIF($1::text, ''),
       login_card_updated_at = now() WHERE id = app_tenant_id() RETURNING id`, [cardUid],
    );
    if (!rows[0]) throw new ForbiddenException('Sin contexto de empresa');
    return { cardUid: cardUid || null };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictException('La tarjeta ya pertenece a otra empresa');
    }
    throw error;
  }
}
