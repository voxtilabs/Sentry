import { ForbiddenException,NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';
import type { AuditService } from '../audit/audit.service';
import { OperationsService } from './operations.service';
import { GuardPersonalService,normalizeGuardRut,encryptGuardRut,decryptGuardRut } from './guard-personal.service';
import { GuardQuotaService } from './guard-quota.service';
const actor={sub:'supervisor-id',role:'SUPERVISOR' as const};
describe('operations scope and minimization',()=>{
 it('rechaza al supervisor de otro recinto antes de leer o escribir destinatarios',async()=>{
  const query=jest.fn().mockResolvedValueOnce([{id:'site'}]).mockResolvedValueOnce([]),rules={updateSiteOverrides:jest.fn()};
  const service=new OperationsService({manager:{query}} as unknown as TenantContextService,rules as unknown as RulesService);
  await expect(service.setRecipients('site',['allowed@example.test'],actor)).rejects.toBeInstanceOf(ForbiddenException);expect(rules.updateSiteOverrides).not.toHaveBeenCalled();
 });
 it('conserva reglas ajenas al actualizar correos y elimina duplicados',async()=>{
  const query=jest.fn().mockResolvedValueOnce([{id:'site'}]).mockResolvedValueOnce([{id:'site'}]).mockResolvedValueOnce([{overrides:{photoMinCount:1,reportRecipients:['old@example.test']}}]).mockResolvedValue([{id:'site'}]);
  const rules={updateSiteOverrides:jest.fn().mockResolvedValue({effective:{reportRecipients:['new@example.test']}}),effective:jest.fn().mockResolvedValue({reportRecipients:['new@example.test']})};
  const service=new OperationsService({manager:{query}} as unknown as TenantContextService,rules as unknown as RulesService);
  await service.setRecipients('site',['new@example.test','new@example.test'],{sub:'admin',role:'ADMIN'});
  expect(rules.updateSiteOverrides).toHaveBeenCalledWith('site',{photoMinCount:1,reportRecipients:['new@example.test']},'admin');
 });
 it('pagina el historial sin tomar informes de recintos no asignados',async()=>{
  const query=jest.fn().mockResolvedValue([{id:'3'},{id:'2'},{id:'1'}]);const service=new OperationsService({manager:{query}} as unknown as TenantContextService,{} as RulesService);
  const result=await service.recent({limit:2,offset:0},actor);expect(result).toEqual({patrols:[{id:'3'},{id:'2'}],hasMore:true,nextOffset:2});expect(query).toHaveBeenCalledWith(expect.stringContaining('ss.supervisor_id=$2'),[false,'supervisor-id',null,null,null,3,0]);
 });
 it('no consulta ni devuelve RUT en el listado general de guardias',async()=>{
  const query=jest.fn().mockResolvedValue([]);await new OperationsService({manager:{query}} as unknown as TenantContextService,{} as RulesService).guards(actor);
  expect(query.mock.calls[0][0]).not.toContain('encrypted_rut');
 });
 it('un guardia ajeno no permite descifrar ni escribir identificación',async()=>{
  const query=jest.fn().mockResolvedValue([]),audit={record:jest.fn()};const service=new GuardPersonalService({manager:{query},tenantId:'tenant'} as unknown as TenantContextService,new ConfigService({JWT_SECRET:'test-fixture-secret'}),audit as unknown as AuditService);
  await expect(service.write('foreign','12345678-5',actor)).rejects.toBeInstanceOf(NotFoundException);expect(query).toHaveBeenCalledTimes(1);expect(audit.record).not.toHaveBeenCalled();
 });
});
describe('optional civil identifier',()=>{
 it('acepta vacío, formatea RUT y rechaza un dígito verificador incorrecto',()=>{expect(normalizeGuardRut('')).toBeNull();expect(normalizeGuardRut('12.345.678-5')).toBe('12345678-5');expect(normalizeGuardRut('123456785')).toBe('12345678-5');expect(()=>normalizeGuardRut('12345678-1')).toThrow();});
 it('cifra con nonce aleatorio y enlaza el dato a empresa y guardia',()=>{const key=randomBytes(32),one=encryptGuardRut('12345678-5',key,'tenant:user');const two=encryptGuardRut('12345678-5',key,'tenant:user');expect(one.equals(two)).toBe(false);expect(one.includes(Buffer.from('12345678-5'))).toBe(false);expect(decryptGuardRut(one,key,'tenant:user')).toBe('12345678-5');expect(()=>decryptGuardRut(one,key,'other:user')).toThrow();const corrupted=Buffer.from(one);corrupted[30]=corrupted[30]!^1;expect(()=>decryptGuardRut(corrupted,key,'tenant:user')).toThrow();});
});
describe('registration limits',()=>{
 it('respeta el máximo de empresa y el del plan',async()=>{const s=new GuardQuotaService({} as TenantContextService,{effective:async()=>({guardCompanyLimit:20})} as unknown as RulesService);expect(await s.companyLimit(60)).toBe(20);expect(await s.companyLimit(15)).toBe(15);});
 it('impide una asignación adicional al llenar el recinto y conserva la repetición idempotente',async()=>{const query=jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{count:20,already:false}]).mockResolvedValueOnce([]).mockResolvedValueOnce([{count:20,already:true}]);const service=new GuardQuotaService({manager:{query}} as unknown as TenantContextService,{effective:async()=>({guardSiteLimit:20})} as unknown as RulesService);await expect(service.site('site','new')).rejects.toThrow('20');await expect(service.site('site','existing')).resolves.toBeUndefined();expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));});
});
