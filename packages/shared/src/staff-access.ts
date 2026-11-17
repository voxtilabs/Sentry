export interface StaffSite {id:string;name:string;branchName:string;}
export interface StaffCompany {tenantId:string;tenantName:string;tenantSlug:string;role:'ADMIN'|'SUPERVISOR';sites:StaffSite[];}
export interface StaffPortfolio {currentTenantId:string|null;companies:StaffCompany[];}
export interface SupervisionDirectory {
 companies:Array<{id:string;name:string;sites:Array<{id:string;name:string}>}>;
 supervisors:Array<{id:string;name:string;email:string|null;memberships:Array<{tenantId:string;siteIds:string[]}>}>;
}
