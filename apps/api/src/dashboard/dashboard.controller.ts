import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { DashboardService } from './dashboard.service';
import { PortfolioQueryDto, PortfolioService } from './portfolio.service';
import { SkipTenantContext } from '../database/tenant-context/skip-tenant-context.decorator';

@Controller('dashboard')
@TenantScope()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService, private readonly portfolioService: PortfolioService) {}

  @Get('tenant')
  @Permissions('tenant:dashboard:read')
  tenantOverview(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.dashboard.getTenantOverview(request.user.sub, request.user.role);
  }

  @Get('portfolio')
  @Header('Cache-Control', 'no-store')
  @Permissions('tenant:dashboard:read')
  @SkipTenantContext()
  portfolio(@Req() request: Request & { user: AuthenticatedUser }, @Query() query: PortfolioQueryDto) {
    return this.portfolioService.overview(request.user, query);
  }
}
