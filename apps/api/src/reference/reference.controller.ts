import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { ReferenceBatchDto, ReferenceScanDto, StartReferenceDto } from './reference.dto';
import { ReferenceService } from './reference.service';
type Actor=Request & {user: AuthenticatedUser};
@Controller('reference-patrols')
@TenantScope()
@Permissions('routes:manage')
export class ReferenceController {
  constructor(private readonly service: ReferenceService) {}
  @Get() catalog(@Req() r: Actor) { return this.service.catalog(r.user); }
  @Post() start(@Body() body: StartReferenceDto,@Req() r: Actor) { return this.service.start(body.routeId,r.user); }
  @Get(':id') detail(@Param('id',ParseUUIDPipe) id: string,@Req() r: Actor) { return this.service.detail(id,r.user); }
  @Post(':id/samples') samples(@Param('id',ParseUUIDPipe) id: string,@Body() body: ReferenceBatchDto,@Req() r: Actor) { return this.service.samples(id,body.points,r.user); }
  @Post(':id/scans') scan(@Param('id',ParseUUIDPipe) id: string,@Body() body: ReferenceScanDto,@Req() r: Actor) { return this.service.scan(id,body,r.user); }
  @Post(':id/finish') finish(@Param('id',ParseUUIDPipe) id: string,@Req() r: Actor) { return this.service.finish(id,r.user); }
  @Post(':id/cancel') cancel(@Param('id',ParseUUIDPipe) id: string,@Req() r: Actor) { return this.service.finish(id,r.user,true); }
}
