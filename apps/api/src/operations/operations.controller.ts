import { Body,Controller,Get,Header,Param,Put,Query,Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { OperationsQuery,RecipientsDto,RutDto } from './operations.dto';
import { OperationsService } from './operations.service';
import { GuardPersonalService } from './guard-personal.service';
class SiteParam{@IsUUID() siteId!:string;}
class UserParam{@IsUUID() userId!:string;}
type Authed=Request&{user:AuthenticatedUser};
@Controller('operations') @TenantScope()
export class OperationsController {
 constructor(private readonly ops:OperationsService,private readonly personal:GuardPersonalService){}
 @Get('sites') @Header('Cache-Control','no-store') @Permissions('reports:read') sites(@Req() req:Authed){return this.ops.sites(req.user);}
 @Get('patrols') @Header('Cache-Control','no-store') @Permissions('reports:read') recent(@Query() query:OperationsQuery,@Req() req:Authed){return this.ops.recent(query,req.user);}
 @Get('sites/:siteId/recipients') @Header('Cache-Control','no-store') @Permissions('reports:read') recipients(@Param() p:SiteParam,@Req() req:Authed){return this.ops.recipients(p.siteId,req.user);}
 @Put('sites/:siteId/recipients') @Header('Cache-Control','no-store') @Permissions('reports:read') setRecipients(@Param() p:SiteParam,@Body() input:RecipientsDto,@Req() req:Authed){return this.ops.setRecipients(p.siteId,input.recipients,req.user);}
 @Get('guards') @Header('Cache-Control','no-store') @Permissions('reports:read') guards(@Req() req:Authed){return this.ops.guards(req.user);}
 @Get('guards/:userId') @Header('Cache-Control','no-store') @Permissions('reports:read') guard(@Param() p:UserParam,@Req() req:Authed){return this.personal.read(p.userId,req.user);}
 @Put('guards/:userId') @Header('Cache-Control','no-store') @Permissions('reports:read') setGuard(@Param() p:UserParam,@Body() input:RutDto,@Req() req:Authed){return this.personal.write(p.userId,input.rut,req.user);}
}
