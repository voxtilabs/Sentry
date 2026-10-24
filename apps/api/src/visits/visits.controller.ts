import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { ExitVisitDto, RegisterVisitDto, VehicleLookupDto, PublicVehicleCheckDto } from './visits.dto';
import { VisitsService } from './visits.service';

type UserRequest = Request & { user: AuthenticatedUser };

@Controller('visits/guard')
@TenantScope()
export class VisitsGuardController {
  constructor(private readonly visits: VisitsService) {}
  @Get('context') @Permissions('visitors:register')
  context(@Req() req: UserRequest) { return this.visits.sites(req.user.sub,'GUARDIA'); }
  @Get('sites/:siteId') @Permissions('visitors:register')
  list(@Param('siteId',ParseUUIDPipe) id: string,@Req() req: UserRequest) { return this.visits.list(id,req.user.sub,'GUARDIA'); }
  @Post() @Permissions('visitors:register')
  register(@Body() input: RegisterVisitDto,@Req() req: UserRequest) { return this.visits.register(req.user.sub,input); }
  @Post('exit') @Permissions('visitors:register')
  exit(@Body() input: ExitVisitDto,@Req() req: UserRequest) { return this.visits.exit(req.user.sub,input); }
  @Post('public-check') @Permissions('visitors:register')
  publicCheck(@Body() input: PublicVehicleCheckDto,@Req() req: UserRequest) { return this.visits.recordPublicCheck(req.user.sub,input); }
  @Post('vehicle') @Permissions('visitors:register')
  lookup(@Body() input: VehicleLookupDto,@Req() req: UserRequest) { return this.visits.lookup(req.user.sub,input); }
  @Get('vehicle/:lookupId') @Permissions('visitors:register')
  lookupStatus(@Param('lookupId',ParseUUIDPipe) id:string,@Req() req:UserRequest) {return this.visits.lookupStatus(req.user.sub,id);}
}

@Controller('visits/management')
@TenantScope()
export class VisitsManagementController {
  constructor(private readonly visits: VisitsService) {}
  @Get('context') @Permissions('visitors:read')
  context(@Req() req: UserRequest) { return this.visits.sites(req.user.sub,req.user.role); }
  @Get('sites/:siteId') @Permissions('visitors:read')
  list(@Param('siteId',ParseUUIDPipe) id: string,@Req() req: UserRequest) { return this.visits.list(id,req.user.sub,req.user.role); }
}
