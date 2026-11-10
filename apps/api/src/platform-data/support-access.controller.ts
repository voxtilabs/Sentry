import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SkipTenantContext } from '../database/tenant-context/skip-tenant-context.decorator';
import { OpenSupportAccessDto } from './dto/support-access.dto';
import { SupportAccessService } from './support-access.service';

class AccessParam {
  @IsUUID()
  supportAccessId!: string;
}

type Autenticado = Request & { user: AuthenticatedUser };

/**
 * Sin @TenantScope: el SUPERADMIN vive fuera del contexto de empresa. Abrir el
 * acceso es una operacion de plataforma; USARLO es lo que entra al tenant, con
 * la cabecera x-support-access-id que lee el interceptor.
 *
 * Y CON @SkipTenantContext, como el resto de /platform. Sin el, el interceptor
 * global exigia una sesion con tenant y los tres endpoints respondian 401 al
 * unico rol que puede usarlos: el mecanismo de soporte auditado de #109 estaba
 * construido, desplegado e inalcanzable. Se descubrio intentando usarlo para
 * diagnosticar una ronda de un cliente.
 */
@Controller('platform/support-access')
@SkipTenantContext()
export class SupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Get()
  @Permissions('platform:support:access')
  active(@Req() request: Autenticado) {
    return this.support.active(request.user.sub);
  }

  @Post()
  @Permissions('platform:support:access')
  open(@Body() input: OpenSupportAccessDto, @Req() request: Autenticado) {
    return this.support.open(request.user.sub, input);
  }

  @Delete(':supportAccessId')
  @Permissions('platform:support:access')
  close(@Param() params: AccessParam, @Req() request: Autenticado) {
    return this.support.close(request.user.sub, params.supportAccessId);
  }
}
