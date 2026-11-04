import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@sentrycore/shared';
import { randomUUID } from 'node:crypto';

import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { RulesService } from '../rules/rules.service';
import { normalizarPatente, normalizarRun } from './identity';
import type { ExitVisitDto, RegisterVisitDto, VehicleLookupDto, PublicVehicleCheckDto } from './visits.dto';
import { emptyVehicleCheck, type VehicleCheckResult } from './vehicle-registry.service';
import { VehicleLookupJobs, VehicleLookupProcessor } from './vehicle-lookup.jobs';

export const VISITOR_NOTICE = 'El recinto registra nombre, RUN, destino, hora de ingreso y salida y, si corresponde, patente y características del vehículo para controlar el acceso. La lectura del carnet se realiza en el teléfono; no se guarda su fotografía ni su número de documento. Puedes solicitar acceso, corrección o eliminación de tus datos a la administración del recinto.';

@Injectable()
export class VisitsService {
  constructor(private readonly context: TenantContextService, private readonly rules: RulesService,
    private readonly vehicleJobs: VehicleLookupJobs,private readonly vehicleProcessor:VehicleLookupProcessor) {}

  async sites(actorId: string, role: Role) {
    const rows = await this.context.manager.query<Array<{ id: string; name: string; branchName: string }>>(
      `SELECT s.id, s.name, s.branch_name AS "branchName" FROM sites s WHERE s.is_active
       AND ($2 = 'ADMIN' OR ($2 = 'GUARDIA' AND EXISTS
         (SELECT 1 FROM guard_sites a WHERE a.tenant_id=s.tenant_id AND a.site_id=s.id AND a.guard_id=$1))
       OR ($2 = 'SUPERVISOR' AND EXISTS
         (SELECT 1 FROM supervisor_sites a WHERE a.tenant_id=s.tenant_id AND a.site_id=s.id AND a.supervisor_id=$1)))
       ORDER BY s.branch_name,s.name`, [actorId, role]);
    const rules = await this.rules.effective();
    return { sites: rows, actorId, tenantId: this.context.tenantId,
      retentionDays: rules.visitorRetentionDays, notice: VISITOR_NOTICE };
  }

  async ensureSite(siteId: string, actorId: string, role: Role) {
    const { sites } = await this.sites(actorId, role);
    if (!sites.some((site) => site.id === siteId)) throw new ForbiddenException('No tienes acceso a este recinto');
  }

  private identity(actorId: string, input: { expectedActorId: string; expectedTenantId: string }) {
    if (input.expectedActorId !== actorId || input.expectedTenantId !== this.context.tenantId) {
      throw new ForbiddenException('Este registro pendiente pertenece a otra sesión');
    }
  }

  async list(siteId: string, actorId: string, role: Role) {
    await this.ensureSite(siteId, actorId, role);
    const rules = await this.rules.effective();
    return this.context.manager.query(
      `SELECT v.id,v.client_visit_id AS "clientVisitId",v.given_names AS "givenNames",
       v.family_names AS "familyNames",v.run,v.entered_at_device AS "enteredAt",
       v.entered_at_server AS "receivedAt",v.exited_at_device AS "exitedAt",v.plate,
       v.vehicle_make AS "vehicleMake",v.vehicle_model AS "vehicleModel",v.vehicle_color AS "vehicleColor",
       v.destination,v.origin_company AS "originCompany",COALESCE(done.result,c.result) AS "vehicleCheck"
       FROM visitor_sessions v LEFT JOIN visitor_vehicle_checks c ON c.tenant_id=v.tenant_id AND c.id=v.vehicle_check_id
       LEFT JOIN visitor_vehicle_checks done ON done.tenant_id=c.tenant_id
         AND done.id=NULLIF(c.result->>'lookupResultId','')::uuid
         AND done.guard_id=c.guard_id AND done.site_id=c.site_id AND done.plate=c.plate
       WHERE v.site_id=$1 AND v.created_at >= now()-make_interval(days=>$2)
       ORDER BY v.entered_at_device DESC,v.id DESC LIMIT 100`, [siteId, rules.visitorRetentionDays]);
  }

  async register(actorId: string, input: RegisterVisitDto) {
    this.identity(actorId, input);
    await this.ensureSite(input.siteId, actorId, 'GUARDIA');
    const run = normalizarRun(input.run);
    const plate = input.arrivesInVehicle ? normalizarPatente(input.plate ?? '') : null;
    if (!run) throw new BadRequestException('Revisa el RUN y su dígito verificador');
    if (input.arrivesInVehicle && !plate) throw new BadRequestException('Revisa la patente del vehículo');
    if (!input.arrivesInVehicle && (input.plate || input.vehicleCheckId || input.vehicleMake || input.vehicleModel || input.vehicleColor)) {
      throw new BadRequestException('Una visita a pie no lleva datos de vehículo');
    }
    const now = Date.now();
    const days = (await this.rules.effective()).visitorRetentionDays;
    if (Date.parse(input.enteredAt) > now + 5 * 60_000 || Date.parse(input.enteredAt) < now - days * 86_400_000) {
      throw new BadRequestException('La hora de ingreso está fuera del período permitido');
    }
    if (input.vehicleCheckId) {
      const checks = await this.context.manager.query<Array<{ id: string }>>(
        'SELECT id FROM visitor_vehicle_checks WHERE id=$1 AND plate=$2 AND site_id=$3 AND guard_id=$4',
        [input.vehicleCheckId, plate, input.siteId, actorId]);
      if (!checks.length) throw new BadRequestException('La consulta vehicular no corresponde a esta visita');
    }
    const rows = await this.context.manager.query<Array<{ id: string }>>(
      `INSERT INTO visitor_sessions(tenant_id,site_id,guard_id,client_visit_id,given_names,family_names,run,
        entered_at_device,arrives_in_vehicle,plate,vehicle_check_id,vehicle_make,vehicle_model,vehicle_color,
        destination,origin_company,notice_version)
       VALUES(app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'2026-10-22')
       ON CONFLICT(tenant_id,guard_id,client_visit_id) DO NOTHING RETURNING id`,
      [input.siteId,actorId,input.clientVisitId,input.givenNames.trim(),input.familyNames.trim(),run,input.enteredAt,
        input.arrivesInVehicle,plate,input.vehicleCheckId ?? null,input.vehicleMake || null,input.vehicleModel || null,
        input.vehicleColor || null,input.destination || null,input.originCompany || null]);
    if (rows[0]) return { id: rows[0].id, replay: false };
    const existing = await this.context.manager.query<Array<{ id: string }>>(
      'SELECT id FROM visitor_sessions WHERE guard_id=$1 AND client_visit_id=$2', [actorId,input.clientVisitId]);
    return { id: existing[0]!.id, replay: true };
  }

  async exit(actorId: string, input: ExitVisitDto) {
    this.identity(actorId, input);
    const visits = await this.context.manager.query<Array<{ site_id: string; entered_at_device: Date; exited_at_device: Date | null }>>(
      'SELECT site_id,entered_at_device,exited_at_device FROM visitor_sessions WHERE id=$1 FOR UPDATE', [input.visitId]);
    const visit = visits[0];
    if (!visit) throw new NotFoundException('No encontramos la visita');
    await this.ensureSite(visit.site_id, actorId, 'GUARDIA');
    if (visit.exited_at_device) return { id: input.visitId, replay: true };
    const when = Date.parse(input.exitedAt);
    if (when < new Date(visit.entered_at_device).getTime() || when > Date.now() + 5 * 60_000) {
      throw new BadRequestException('La salida debe ser posterior al ingreso');
    }
    await this.context.manager.query(
      'UPDATE visitor_sessions SET exited_at_device=$2,exited_at_server=now(),exit_guard_id=$3 WHERE id=$1',
      [input.visitId,input.exitedAt,actorId]);
    return { id: input.visitId, replay: false };
  }

  async recordPublicCheck(actorId: string, input: PublicVehicleCheckDto) {
    await this.ensureSite(input.siteId,actorId,'GUARDIA');
    if (Math.abs(Date.now()-Date.parse(input.checkedAt))>10*60_000) throw new BadRequestException('Repite la consulta para registrar un resultado reciente');
    const result: VehicleCheckResult = {source:'Auto Seguro (consulta asistida en teléfono)',checkedAt:input.checkedAt,
      detailsStatus:'no_disponible',make:null,model:null,color:null,ownerName:null,
      stolenStatus:input.stolenStatus,finesStatus:'no_consultado',finesCount:null,finesTotal:null};
    if(input.previousCheckId) {
      const rows=await this.context.manager.query<Array<{result:VehicleCheckResult}>>(
        'SELECT result FROM visitor_vehicle_checks WHERE id=$1 AND site_id=$2 AND plate=$3 AND guard_id=$4',
        [input.previousCheckId,input.siteId,input.plate,actorId]);
      if(!rows[0]) throw new BadRequestException('La consulta anterior no corresponde a esta patente');
      Object.assign(result,{...rows[0].result,stolenStatus:input.stolenStatus,checkedAt:input.checkedAt,
        source:[rows[0].result.source,'Auto Seguro (consulta asistida en teléfono)'].filter(Boolean).join(' + ')});
    }
    const id=randomUUID();
    await this.context.manager.query('INSERT INTO visitor_vehicle_checks(id,tenant_id,site_id,guard_id,plate,result) VALUES($1,app_tenant_id(),$2,$3,$4,$5::jsonb)',
      [id,input.siteId,actorId,input.plate,JSON.stringify(result)]);
    return {lookupId:id,plate:input.plate,...result};
  }

  async lookup(actorId: string, input: VehicleLookupDto) {
    await this.ensureSite(input.siteId,actorId,'GUARDIA');
    const plate = normalizarPatente(input.plate);
    if (!plate) throw new BadRequestException('Revisa la patente del vehículo');
    const rows = await this.context.manager.query<Array<{ id: string; result: VehicleCheckResult }>>(
      `SELECT id,result FROM visitor_vehicle_checks WHERE site_id=$1 AND plate=$2 AND guard_id=$3
       AND created_at>now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1`, [input.siteId,plate,actorId]);
    if (rows[0]) return this.lookupStatus(actorId,rows[0].id);
    const tenantId=this.context.tenantId;
    if(!tenantId)throw new ForbiddenException('Se requiere una sesión de empresa');
    const id = randomUUID();
    const resultId=randomUUID();
    const result:VehicleCheckResult={...emptyVehicleCheck(),lookupPending:true,lookupResultId:resultId,
      officialCheck:{source:'Auto Seguro',status:'pendiente',checkedAt:null}};
    await this.context.manager.query(
      'INSERT INTO visitor_vehicle_checks(id,tenant_id,site_id,guard_id,plate,result) VALUES($1,app_tenant_id(),$2,$3,$4,$5::jsonb)',
      [id,input.siteId,actorId,plate,JSON.stringify(result)]);
    const data={tenantId,actorId,lookupId:id,resultId,plate};
    this.context.afterCommit(async()=>{
      try {await this.vehicleJobs.enqueue(data);}
      catch {await this.vehicleProcessor.finish(data,{...emptyVehicleCheck(),lookupPending:false,
        officialCheck:{source:'Auto Seguro',status:'no_disponible',checkedAt:null}});}
    });
    return { lookupId:id,plate,...result };
  }

  async lookupStatus(actorId:string,id:string) {
    const rows=await this.context.manager.query<Array<{id:string;site_id:string;plate:string;result:VehicleCheckResult}>>(
      'SELECT id,site_id,plate,result FROM visitor_vehicle_checks WHERE id=$1 AND guard_id=$2',[id,actorId]);
    const original=rows[0];
    if(!original)throw new NotFoundException('No encontramos la consulta vehicular');
    await this.ensureSite(original.site_id,actorId,'GUARDIA');
    if(original.result.lookupResultId) {
      const completed=await this.context.manager.query<Array<{id:string;result:VehicleCheckResult}>>(
        'SELECT id,result FROM visitor_vehicle_checks WHERE id=$1 AND site_id=$2 AND guard_id=$3 AND plate=$4',
        [original.result.lookupResultId,original.site_id,actorId,original.plate]);
      if(completed[0])return {lookupId:completed[0].id,plate:original.plate,...completed[0].result};
    }
    const progress=original.result.lookupPending&&this.context.tenantId
      ? await this.vehicleJobs.progress(id,this.context.tenantId):null;
    return {lookupId:id,plate:original.plate,...original.result,...progress};
  }
}
