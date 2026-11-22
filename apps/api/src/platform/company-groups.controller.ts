import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SkipTenantContext } from '../database/tenant-context/skip-tenant-context.decorator';
import { PlatformService } from './platform.service';

type ActorRequest = Request & { user: AuthenticatedUser };

export class SaveCompanyGroupDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  companyIds!: string[];
}

class AssignGroupSitesDto {
  @IsBoolean()
  allSites!: boolean;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  siteIds!: string[];
}

@Controller('platform/company-groups')
@SkipTenantContext()
@Permissions('platform:tenants:manage')
export class CompanyGroupsController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  directory(@Req() req: ActorRequest) {
    return this.platform.companyGroups(req.user.sub);
  }

  @Post()
  create(@Req() req: ActorRequest, @Body() input: SaveCompanyGroupDto) {
    return this.platform.saveCompanyGroup(req.user.sub, null, input.name, input.companyIds);
  }

  @Put(':groupId')
  update(@Req() req: ActorRequest, @Param('groupId', ParseUUIDPipe) groupId: string, @Body() input: SaveCompanyGroupDto) {
    return this.platform.saveCompanyGroup(req.user.sub, groupId, input.name, input.companyIds);
  }

  @Put(':groupId/supervisors/:supervisorId')
  assign(@Req() req: ActorRequest, @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('supervisorId', ParseUUIDPipe) supervisorId: string, @Body() input: AssignGroupSitesDto) {
    return this.platform.assignCompanyGroupSites(req.user.sub, groupId, supervisorId, input.allSites, input.siteIds);
  }
}
