import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { argon2id, hash } from 'argon2';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';

import type { CreateTenantDto } from './dto/create-tenant.dto';
import { companyCodeLookup, generateCompanyCode } from '../auth/company-code';

interface TenantRow {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  status: 'active' | 'suspended';
  plan_key: string;
  plan_name: string;
  user_limit: number;
  site_limit: number;
  site_count: number;
  user_count: number;
  monthly_patrol_count: number;
  last_patrol_at: Date | null;
  created_at: Date;
}

interface BillingRow {
  tenant_id: string;
  display_name: string;
  active_site_count: number;
  active_supervisor_count: number;
  billable_unit_count: number;
  net_amount_clp: number;
  billing_month: string;
}

@Injectable()
export class PlatformService {
  constructor(private readonly dataSource: DataSource) {}

  async companyCode(actorId: string, tenantId: string) {
    const rows = await this.withPlatformActor(actorId, manager => manager.query(
      'SELECT configured, updated_at AS "updatedAt" FROM platform_company_code_status($1,$2)', [actorId, tenantId]));
    return rows[0];
  }

  async renewCompanyCode(actorId: string, tenantId: string) {
    const code = generateCompanyCode();
    await this.withPlatformActor(actorId, manager => manager.query(
      'SELECT platform_set_company_code($1,$2,$3)', [actorId, tenantId, companyCodeLookup(code)]));
    return { code, configured: true };
  }

  async companyCard(actorId: string, tenantId: string) {
    const rows = await this.withPlatformActor(actorId, (manager) =>
      manager.query<Array<{ card_uid: string | null }>>('SELECT platform_get_company_card($1, $2) AS card_uid', [actorId, tenantId]));
    return { cardUid: rows[0]!.card_uid };
  }

  async setCompanyCard(actorId: string, tenantId: string, cardUid: string) {
    try {
      await this.withPlatformActor(actorId, (manager) =>
        manager.query('SELECT platform_set_company_card($1, $2, $3)', [actorId, tenantId, cardUid]));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('La tarjeta ya pertenece a otra empresa');
      if ((error as { code?: string }).code === 'P0002') throw new NotFoundException('Empresa no encontrada');
      throw error;
    }
    return { cardUid: cardUid || null };
  }

  async listTenants(actorId: string) {
    const rows = await this.withPlatformActor(actorId, (manager) =>
      manager.query<TenantRow[]>(`SELECT * FROM platform_list_tenants($1)`, [actorId]),
    );
    return rows.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      legalName: tenant.legal_name,
      displayName: tenant.display_name,
      status: tenant.status,
      planKey: tenant.plan_key,
      planName: tenant.plan_name,
      userLimit: tenant.user_limit,
      siteLimit: tenant.site_limit,
      siteCount: tenant.site_count,
      userCount: tenant.user_count,
      monthlyPatrolCount: tenant.monthly_patrol_count,
      lastPatrolAt: tenant.last_patrol_at,
      createdAt: tenant.created_at,
    }));
  }

  async createTenant(actorId: string, input: CreateTenantDto) {
    const tenantId = randomUUID();
    const companyAccessCode = generateCompanyCode();
    const adminId = randomUUID();
    const passwordHash = await hash(input.adminPassword, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });

    try {
      await this.withPlatformActor(actorId, async (manager) => {
        await manager.query(
          `SELECT platform_create_tenant(
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          )`,
          [
            actorId,
            tenantId,
            input.slug,
            input.legalName,
            input.displayName,
            input.planKey,
            adminId,
            input.adminEmail.toLowerCase(),
            passwordHash,
            input.adminGivenName,
            input.adminFamilyName,
          ],
        );
        if (input.loginCardUid) {
          await manager.query('SELECT platform_set_company_card($1, $2, $3)', [actorId, tenantId, input.loginCardUid]);
        }
        await manager.query('SELECT platform_set_company_code($1,$2,$3)',
          [actorId, tenantId, companyCodeLookup(companyAccessCode)]);
      });
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === '23505') {
        throw new ConflictException('El slug o correo ya está registrado');
      }
      throw error;
    }

    return { id: tenantId, adminId, companyAccessCode };
  }

  async currentBilling(actorId: string) {
    const rows = await this.withPlatformActor(actorId, (manager) =>
      manager.query<BillingRow[]>(`SELECT * FROM platform_current_billing($1)`, [actorId]),
    );
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      displayName: row.display_name,
      activeSiteCount: row.active_site_count,
      activeSupervisorCount: row.active_supervisor_count,
      billableUnitCount: row.billable_unit_count,
      netAmountClp: row.net_amount_clp,
      billingMonth: row.billing_month,
    }));
  }

  async setTenantStatus(
    actorId: string,
    tenantId: string,
    status: 'active' | 'suspended',
  ) {
    try {
      await this.withPlatformActor(actorId, (manager) =>
        manager.query(`SELECT platform_set_tenant_status($1, $2, $3)`, [
          actorId,
          tenantId,
          status,
        ]),
      );
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === 'P0002') {
        throw new NotFoundException('Empresa no encontrada');
      }
      throw error;
    }
    return { id: tenantId, status };
  }

  private withPlatformActor<T>(
    actorId: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.user_id', $1, true)`, [actorId]);
      return operation(manager);
    });
  }

  companyGroups(actorId: string) {
    return this.withPlatformActor(actorId, async manager => {
      const [row] = await manager.query<Array<{ directory: unknown }>>('SELECT platform_company_groups() AS directory');
      return row?.directory;
    });
  }

  async saveCompanyGroup(actorId: string, groupId: string | null, name: string, companyIds: string[]) {
    const [row] = await this.groupChange<Array<{ id: string }>>(actorId,
      'SELECT save_company_group($1, $2, $3) AS id', [groupId, name, companyIds]);
    return { id: row?.id };
  }

  async assignCompanyGroupSites(actorId: string, groupId: string, supervisorId: string, allSites: boolean, siteIds: string[]) {
    await this.groupChange(actorId, 'SELECT assign_company_group_sites($1, $2, $3, $4)', [groupId, supervisorId, allSites, siteIds]);
    return { updated: true };
  }

  private async groupChange<T>(actorId: string, sql: string, parameters: unknown[]): Promise<T> {
    try {
      return await this.withPlatformActor(actorId, manager => manager.query(sql, parameters) as Promise<T>);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const { code, constraint } = error.driverError as { code?: string; constraint?: string };
        if (code === '42501') throw new ForbiddenException('Se requiere acceso de superadministración.');
        if (code === 'P0002') throw new NotFoundException('El grupo o supervisor seleccionado no está disponible.');
        if (code === '22023') throw new BadRequestException('Revisa las empresas, recintos y roles de la selección.');
        if (code === '23505') throw new ConflictException(constraint === 'company_groups_name_idx'
          ? 'Ya existe un grupo con ese nombre.'
          : 'Una de las empresas ya pertenece a otro grupo.');
      }
      throw error;
    }
  }
}
