import { ForbiddenException } from '@nestjs/common';
import type { AdminService } from './admin.service';
import type { OperationsService } from '../operations/operations.service';
import type { GuardPersonalService } from '../operations/guard-personal.service';
import type { AuditService } from '../audit/audit.service';
import { GuardRegistrationController } from './guard-registration.controller';
describe('alta de guardias desde supervisión',()=>{
 it('rechaza el recinto ajeno antes de crear una cuenta',async()=>{const createSiteGuard=jest.fn();const controller=new GuardRegistrationController({createSiteGuard} as unknown as AdminService,{site:async()=>{throw new ForbiddenException();}} as unknown as OperationsService,{} as GuardPersonalService,{} as AuditService);await expect(controller.create({siteId:'foreign',givenName:'Persona',familyName:'Prueba'},{user:{sub:'supervisor',role:'SUPERVISOR'}} as never)).rejects.toBeInstanceOf(ForbiddenException);expect(createSiteGuard).not.toHaveBeenCalled();});
 it('fija rol Guardia y crea credencial aleatoria sin aceptar consentimientos',async()=>{const admin={createSiteGuard:jest.fn().mockResolvedValue({id:'new',invitationSent:false}),setSupervisorSite:jest.fn()},personal={write:jest.fn()},audit={record:jest.fn()};const controller=new GuardRegistrationController(admin as unknown as AdminService,{site:async()=>{}} as unknown as OperationsService,personal as unknown as GuardPersonalService,audit as unknown as AuditService);await controller.create({siteId:'assigned',givenName:'Persona',familyName:'Prueba'},{user:{sub:'supervisor',role:'SUPERVISOR'}} as never);expect(admin.createSiteGuard).toHaveBeenCalledWith(expect.objectContaining({password:expect.stringMatching(/^.{32,}$/)}),'assigned');expect(personal.write).not.toHaveBeenCalled();});
});
