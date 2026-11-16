import { BadRequestException,Injectable } from '@nestjs/common';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { RulesService } from '../rules/rules.service';
@Injectable()
export class GuardQuotaService{
 constructor(private readonly ctx:TenantContextService,private readonly rules:RulesService){}
 async lock(){await this.ctx.manager.query("SELECT pg_advisory_xact_lock(hashtextextended('guard-registration:'||app_tenant_id()::text,0))");}
 async companyLimit(planLimit:number){const rules=await this.rules.effective();return Math.min(planLimit,rules.guardCompanyLimit);}
 async site(siteId:string,userId:string|null=null){
  await this.lock();const rules=await this.rules.effective({siteId});
  const [row]=await this.ctx.manager.query<Array<{count:number;already:boolean}>>(`SELECT count(DISTINCT gs.guard_id)::int AS count,
    coalesce(bool_or(gs.guard_id=$2::uuid),false) AS already FROM guard_sites gs JOIN users u ON u.id=gs.guard_id
    WHERE gs.site_id=$1 AND u.is_active`,[siteId,userId]);
  if(!row?.already && Number(row?.count??0)>=rules.guardSiteLimit)throw new BadRequestException(`Este recinto alcanzó el límite de ${rules.guardSiteLimit} guardias activos. Pide al administrador revisar el límite.`);
 }
 async activation(userId:string){const sites=await this.ctx.manager.query<Array<{site_id:string}>>('SELECT site_id FROM guard_sites WHERE guard_id=$1',[userId]);for(const s of sites)await this.site(s.site_id,userId);}
}
