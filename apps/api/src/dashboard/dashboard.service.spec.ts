import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  it('aplica asignaciones de recinto al supervisor', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            site_count: 1,
            guard_count: 1,
            pending_patrol_count: 1,
            active_patrol_count: 0,
            completed_patrol_count: 0,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const service = new DashboardService({ manager } as unknown as TenantContextService);

    await expect(service.getTenantOverview('supervisor-id', 'SUPERVISOR')).resolves.toMatchObject({
      scope: 'assigned_sites',
      metrics: { sites: 1 },
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('assignment.supervisor_id = $2'),
      [true, 'supervisor-id'],
    );
  });

  it('permite al admin consultar el tenant completo', async () => {
    const manager = { query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]) };
    const service = new DashboardService({ manager } as unknown as TenantContextService);

    await expect(service.getTenantOverview('admin-id', 'ADMIN')).resolves.toMatchObject({
      scope: 'tenant',
    });
    expect(manager.query).toHaveBeenCalledWith(expect.any(String), [false, 'admin-id']);
  });
});

describe('resumen operativo reciente',()=>{
 it('entrega cifras de las últimas 24 h sin confundirlas con el histórico',async()=>{
  const manager={query:jest.fn().mockResolvedValueOnce([{site_count:2,guard_count:3,pending_patrol_count:0,active_patrol_count:1,completed_patrol_count:99,completed_last_24h:4,incomplete_last_24h:1,average_last_24h:90}]).mockResolvedValueOnce([])};
  const result=await new DashboardService({manager} as unknown as TenantContextService).getTenantOverview('admin-id','ADMIN');
  expect(result.metrics).toMatchObject({completedPatrols:99,completedLast24h:4,incompleteLast24h:1,averageLast24h:90});
 });
});
