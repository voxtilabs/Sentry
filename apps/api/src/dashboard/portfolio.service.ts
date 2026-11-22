import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { StaffCompany } from '@sentrycore/shared';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { MAX_DIAS_ESCANEOS, resolverRango } from '../stats/stats-range';
import { PORTFOLIO_DAILY } from './portfolio-queries';

const scopes = ['all', 'group', 'company', 'site'] as const;
type Scope = typeof scopes[number];
type Selection = { scope: Scope; scopeId?: string };

export class PortfolioQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsIn(scopes)
  scope?: Scope;

  @IsOptional()
  @IsUUID()
  scopeId?: string;
}

interface PortfolioRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role_key: StaffCompany['role'];
  sites: StaffCompany['sites'];
}

interface GroupRow {
  id: string;
  name: string;
  company_ids: string[];
}

const empty = {
  patrols: 0, voluntary: 0, completed: 0, incomplete: 0, expired: 0, active: 0, waiting: 0,
  complianceSum: 0, complianceCount: 0, scans: 0, scansFlagged: 0, scansNfc: 0, scansWithGps: 0,
  gpsAccuracyCount: 0, gpsAccuracySum: 0, tasksExpected: 0, tasksDone: 0, tasksFailed: 0, legacyResponses: 0,
};

type Totals = typeof empty;
type DailyRow = Totals & { siteId: string; day: string };
const totalKeys = Object.keys(empty) as Array<keyof Totals>;

function indexBy(rows: DailyRow[], key: 'day' | 'siteId') {
  const index = new Map<string, DailyRow[]>();
  for (const row of rows) {
    const entries = index.get(row[key]);
    if (entries) entries.push(row);
    else index.set(row[key], [row]);
  }
  return index;
}

function sum<T extends Totals>(items: readonly T[]) {
  const total = { ...empty };
  for (const item of items) for (const key of totalKeys) total[key] += item[key];
  return total;
}

function ratio(value: number, count: number, multiplier = 100) {
  return count > 0 ? Math.round(value * multiplier * 10 / count) / 10 : null;
}

function view(totals: Totals) {
  const { complianceSum, complianceCount, gpsAccuracySum, gpsAccuracyCount, ...counts } = totals;
  return {
    ...counts,
    scheduled: counts.patrols - counts.voluntary,
    compliancePct: ratio(complianceSum, complianceCount, 1),
    scanGpsPct: ratio(counts.scansWithGps, counts.scans),
    scanNfcPct: ratio(counts.scansNfc, counts.scans),
    avgAccuracyM: ratio(gpsAccuracySum, gpsAccuracyCount, 1),
    taskPct: ratio(counts.tasksDone, counts.tasksExpected),
  };
}

@Injectable()
export class PortfolioService {
  constructor(private readonly dataSource: DataSource) {}

  async overview(user: AuthenticatedUser, query: PortfolioQueryDto) {
    const range = resolverRango(query.from, query.to, MAX_DIAS_ESCANEOS);
    const needsId = query.scope !== undefined && query.scope !== 'all';
    if (needsId !== Boolean(query.scopeId)) {
      throw new BadRequestException('Selecciona un grupo, empresa o recinto válido.');
    }
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query(`SELECT set_config('app.user_id',$1,true),
        set_config('app.tenant_id','',true),set_config('app.support_access_id','',true)`, [user.sub]);
      const portfolio = await manager.query<PortfolioRow[]>('SELECT * FROM staff_company_portfolio()');
      const groups = (await manager.query<GroupRow[]>('SELECT * FROM staff_company_groups()'))
        .map(row => ({ id: row.id, name: row.name, companyIds: row.company_ids }));
      const companies: StaffCompany[] = portfolio.filter(row => row.sites.length > 0).map(row => ({
        tenantId: row.tenant_id, tenantName: row.tenant_name, tenantSlug: row.tenant_slug,
        role: row.role_key, sites: row.sites,
      }));
      const initial = groups.find(group => group.companyIds.includes(user.tenant_id ?? ''));
      const selected: Selection = query.scope
        ? { scope: query.scope, ...(query.scopeId ? { scopeId: query.scopeId } : {}) }
        : initial ? { scope: 'group', scopeId: initial.id } : { scope: 'all' };
      const scopeCompanies = this.matchCompanies(companies, groups, selected);

      const daily: DailyRow[] = [];
      for (const company of scopeCompanies) {
        // IDs come from the server-side portfolio. The request never sets RLS
        // context directly, and only the allowed site IDs reach the query.
        await manager.query("SELECT set_config('app.tenant_id',$1,true)", [company.tenantId]);
        daily.push(...await manager.query<DailyRow[]>(PORTFOLIO_DAILY,
          [range.desde, range.hasta, company.sites.map(site => site.id)]));
      }
      const bySite = indexBy(daily, 'siteId');
      const byDay = indexBy(daily, 'day');
      const sites = scopeCompanies.flatMap(company => company.sites.map(site => ({
        siteId: site.id, tenantId: company.tenantId, ...view(sum(bySite.get(site.id) ?? [])),
      })));
      const companyMetrics = scopeCompanies.map(company => ({
        tenantId: company.tenantId, ...view(sum(company.sites.flatMap(site => bySite.get(site.id) ?? []))),
      }));
      const start = Date.parse(range.desde);
      const days = Array.from({ length: range.dias }, (_, offset) => {
        const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
        return { day, ...view(sum(byDay.get(day) ?? [])) };
      });
      return { range, groups, companies, selected, sites, companyMetrics, days, totals: view(sum(daily)) };
    });
  }

  private matchCompanies(companies: StaffCompany[], groups: Array<{ id: string; companyIds: string[] }>, selected: Selection) {
    if (selected.scope === 'all') return companies;
    const group = groups.find(candidate => candidate.id === selected.scopeId);
    const allowed = companies.filter(company => {
      if (selected.scope === 'group') return group?.companyIds.includes(company.tenantId);
      if (selected.scope === 'company') return company.tenantId === selected.scopeId;
      return company.sites.some(site => site.id === selected.scopeId);
    });
    if (!allowed.length) throw new NotFoundException('Ese grupo, empresa o recinto no está disponible para tu cuenta.');
    return selected.scope === 'site' ? allowed.map(company => ({
      ...company, sites: company.sites.filter(site => site.id === selected.scopeId),
    })) : allowed;
  }
}
