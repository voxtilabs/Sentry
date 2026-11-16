import { filasDe } from '../consent/sql-result';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { normalizarRun } from '@sentrycore/shared';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { AuditService } from '../audit/audit.service';
type Actor=Pick<AuthenticatedUser,'sub'|'role'>;
export function normalizeGuardRut(value:string):string|null {
  const raw=value.trim().toUpperCase().replace(/[.\s-]/g,'');
  if(!raw)return null;
  const valid=normalizarRun(raw.slice(0,-1)+'-'+raw.slice(-1));
  if(!valid)throw new BadRequestException('Revisa el RUT y su dígito verificador.');
  return valid;
}
export function encryptGuardRut(value:string,key:Buffer,context:string):Buffer {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),encrypted]);
}
export function decryptGuardRut(value:Buffer,key:Buffer,context:string):string {
 if(value[0]!==1)throw new Error('Unsupported personal data format');
 const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(1,13));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(value.subarray(13,29));
 return Buffer.concat([decipher.update(value.subarray(29)),decipher.final()]).toString('utf8');
}
@Injectable()
export class GuardPersonalService {
 private readonly key:Buffer;
 constructor(private readonly ctx:TenantContextService,config:ConfigService,private readonly audit:AuditService){
  this.key=createHash('sha256').update('sentrycore:guard-rut:v1\0').update(config.getOrThrow<string>('JWT_SECRET')).digest();
 }
 async assertScope(userId:string,actor:Actor){
  const rows=await this.ctx.manager.query<Array<{id:string}>>(`SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id
   WHERE u.id=$1 AND m.role_key='GUARDIA' AND ($2::boolean OR EXISTS (
    SELECT 1 FROM guard_sites gs JOIN supervisor_sites ss ON ss.site_id=gs.site_id
    WHERE gs.guard_id=u.id AND ss.supervisor_id=$3))`,[userId,actor.role==='ADMIN',actor.sub]);
  if(!rows.length)throw new NotFoundException('Guardia no disponible en tus recintos.');
  if(!this.ctx.tenantId)throw new ForbiddenException();
 }
 async clearForRoleChange(userId:string,actor:Actor){
  if(actor.role!=='ADMIN'||!this.ctx.tenantId)throw new ForbiddenException();
  const rows=filasDe<{user_id:string}>(await this.ctx.manager.query('DELETE FROM guard_personal_data WHERE user_id=$1 RETURNING user_id',[userId]));
  if(rows.length)await this.audit.record({actorId:actor.sub,actorLabel:actor.role,action:'guardia.identificacion_modificada',entityType:'user',entityId:userId,summary:'RUT eliminado al cambiar el rol'});
 }
 async read(userId:string,actor:Actor){
  await this.assertScope(userId,actor);
  const rows=await this.ctx.manager.query<Array<{encrypted_rut:Buffer}>>('SELECT encrypted_rut FROM guard_personal_data WHERE user_id=$1',[userId]);
  const rut=rows[0]?decryptGuardRut(rows[0].encrypted_rut,this.key,`${this.ctx.tenantId}:${userId}`):null;
  await this.audit.record({actorId:actor.sub,actorLabel:actor.role,action:'guardia.identificacion_consultada',entityType:'user',entityId:userId});
  return {userId,rut};
 }
 async write(userId:string,value:string,actor:Actor){
  await this.assertScope(userId,actor);const rut=normalizeGuardRut(value);
  if(rut){await this.ctx.manager.query(`INSERT INTO guard_personal_data(tenant_id,user_id,encrypted_rut) VALUES(app_tenant_id(),$1,$2)
   ON CONFLICT(tenant_id,user_id) DO UPDATE SET encrypted_rut=excluded.encrypted_rut,updated_at=now()`,[userId,encryptGuardRut(rut,this.key,`${this.ctx.tenantId}:${userId}`)]);}
  else await this.ctx.manager.query('DELETE FROM guard_personal_data WHERE user_id=$1',[userId]);
  await this.audit.record({actorId:actor.sub,actorLabel:actor.role,action:'guardia.identificacion_modificada',entityType:'user',entityId:userId,summary:rut?'RUT actualizado':'RUT eliminado'});
  return {userId,hasRut:rut!==null};
 }
}
