import type { StaffCompany } from '@sentrycore/shared';
import { operationRequest } from './operations-client';
import { rememberSessionLifetime, withSessionChange } from './use-session-refresh';
import { guardarCodigoEmpresa } from '../_lib/codigo-empresa';
import { staffViewQuery } from './panel-navigation';

export const STAFF_COMPANY_CHANGE_KEY='sentrycore.staff.company';

export async function openStaffCompany(apiUrl:string,company:StaffCompany,currentTenantId:string|null,view='recintos',siteId?:string):Promise<void> {
 if(company.tenantId!==currentTenantId) {
  await withSessionChange(async()=>{
   const session=await operationRequest<{expiresIn:number}>(`${apiUrl}/auth/switch-company`,'POST',{tenantId:company.tenantId});
   rememberSessionLifetime(session.expiresIn);
   guardarCodigoEmpresa(company.tenantSlug);
   // All staff tabs share the HttpOnly cookies; refresh their company context too.
   try {window.localStorage.setItem(STAFF_COMPANY_CHANGE_KEY,`${company.tenantId}:${Date.now()}`);} catch { /* Storage may be disabled. */ }
  });
 }
 const targetView=company.role==='ADMIN' && view==='terreno'?'recintos':view;
 window.location.assign(`/app/${company.role.toLowerCase()}${staffViewQuery(targetView,siteId)}`);
}
