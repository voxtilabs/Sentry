import { Body, Controller, Get, Header, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { UpdateCompanyCardDto } from '../auth/dto/company-card.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SkipTenantContext } from '../database/tenant-context/skip-tenant-context.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { PlatformService } from './platform.service';
import { MailQueueService } from '../mail/mail-queue.service';

class TenantIdParam {
  @IsUUID()
  tenantId!: string;
}

@Controller('platform/tenants')
@SkipTenantContext()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly mailQueue: MailQueueService,
  ) {}

  @Get()
  @Permissions('platform:tenants:manage')
  list(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.platform.listTenants(request.user.sub);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Permissions('platform:tenants:manage')
  create(
    @Req() request: Request & { user: AuthenticatedUser },
    @Body() input: CreateTenantDto,
  ) {
    return this.platform.createTenant(request.user.sub, input);
  }

  @Get('billing/current')
  @Permissions('platform:metrics:read')
  billing(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.platform.currentBilling(request.user.sub);
  }

  @Get('mail-queue')
  @Permissions('platform:metrics:read')
  mailQueueStatus() {
    return this.mailQueue.supportStatus();
  }

  @Patch(':tenantId/status')
  @Permissions('platform:tenants:manage')
  updateStatus(
    @Req() request: Request & { user: AuthenticatedUser },
    @Param() params: TenantIdParam,
    @Body() input: UpdateTenantStatusDto,
  ) {
    return this.platform.setTenantStatus(request.user.sub, params.tenantId, input.status);
  }

  @Get(':tenantId/company-card')
  @Permissions('platform:tenants:manage')
  companyCard(@Req() request: Request & { user: AuthenticatedUser }, @Param() params: TenantIdParam) {
    return this.platform.companyCard(request.user.sub, params.tenantId);
  }

  @Get(':tenantId/company-code')
  @Header('Cache-Control', 'no-store')
  @Permissions('platform:tenants:manage')
  companyCode(@Req() request: Request & { user: AuthenticatedUser }, @Param() params: TenantIdParam) {
    return this.platform.companyCode(request.user.sub, params.tenantId);
  }

  @Post(':tenantId/company-code')
  @Header('Cache-Control', 'no-store')
  @Permissions('platform:tenants:manage')
  renewCompanyCode(@Req() request: Request & { user: AuthenticatedUser }, @Param() params: TenantIdParam) {
    return this.platform.renewCompanyCode(request.user.sub, params.tenantId);
  }

  @Put(':tenantId/company-card')
  @Permissions('platform:tenants:manage')
  setCompanyCard(@Req() request: Request & { user: AuthenticatedUser }, @Param() params: TenantIdParam,
    @Body() input: UpdateCompanyCardDto) {
    return this.platform.setCompanyCard(request.user.sub, params.tenantId, input.cardUid);
  }
}
