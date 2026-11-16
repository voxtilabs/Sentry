import { Transform } from 'class-transformer';
import { Body,Controller,Post,Req } from '@nestjs/common';
import { IsOptional,IsString,IsUUID,Length,MaxLength } from 'class-validator';
import { randomBytes,randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { OperationsService } from '../operations/operations.service';
import { GuardPersonalService,normalizeGuardRut } from '../operations/guard-personal.service';
import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';
class CreateGuardDto{
 @IsUUID() siteId!:string;
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @Length(2,80) givenName!:string;
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @Length(2,80) familyName!:string;
 @IsOptional() @IsString() @MaxLength(16) rut?:string;
}
@Controller('personnel') @TenantScope()
export class GuardRegistrationController{
 constructor(private readonly admin:AdminService,private readonly ops:OperationsService,private readonly personal:GuardPersonalService,private readonly audit:AuditService){}
 @Post('guards') @Permissions('reports:read')
 async create(@Body() input:CreateGuardDto,@Req() req:Request&{user:AuthenticatedUser}){
  await this.ops.site(input.siteId,req.user);
  if(input.rut!==undefined)normalizeGuardRut(input.rut);
  const result=await this.admin.createSiteGuard({givenName:input.givenName.trim(),familyName:input.familyName.trim(),username:'guard.'+randomUUID(),password:randomBytes(32).toString('base64url')},input.siteId);
  if(input.rut?.trim())await this.personal.write(result.id,input.rut,req.user);
  await this.audit.record({actorId:req.user.sub,actorLabel:req.user.role,action:'usuario.creado',entityType:'user',entityId:result.id,summary:'Guardia creado y asignado a un recinto autorizado'});
  return result;
 }
}
