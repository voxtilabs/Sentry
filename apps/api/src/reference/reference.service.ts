import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard';
import { TenantContextService } from '../database/tenant-context/tenant-context.service';
import { GpsPolicyService } from '../geo/gps-policy.service';
import { RulesService } from '../rules/rules.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import type { ReferencePointDto, ReferenceScanDto } from './reference.dto';
interface Point { id: string; name: string; position: number; uids: string[] }
interface Walk { id: string; site_id: string; route_id: string; operator_id: string; status: string;
  started_at: Date; deadline: Date; ended_at: Date | null; target_accuracy_m: number; checkpoints: Point[] }

/** Separate versioned observations: never changes checkpoints or historic guard traces. */
@Injectable()
export class ReferenceService {
  constructor(private readonly ctx: TenantContextService, private readonly supervisors: SupervisorService,
    private readonly gps: GpsPolicyService, private readonly rules: RulesService) {}
  private get db() { return this.ctx.manager; }
  private async scope(site: string, user: AuthenticatedUser) {
    if (user.role === 'SUPERVISOR') await this.supervisors.ensureAssignedSite(site, user.sub);
    else if (user.role !== 'ADMIN') throw new ForbiddenException();
  }
  async catalog(user: AuthenticatedUser) {
    const rows = await this.db.query(`SELECT r.id,r.name,r.site_id,s.name AS site_name FROM routes r
      JOIN sites s ON s.tenant_id=r.tenant_id AND s.id=r.site_id WHERE r.is_active AND
      ($1::text='ADMIN' OR EXISTS(SELECT 1 FROM supervisor_sites ss WHERE ss.tenant_id=r.tenant_id AND ss.site_id=r.site_id AND ss.supervisor_id=$2)) ORDER BY s.name,r.name`, [user.role,user.sub]);
    const active = await this.db.query(`SELECT * FROM reference_walks WHERE operator_id=$1 AND status='recording' ORDER BY started_at DESC LIMIT 1`, [user.sub]);
    return { routes: rows, active: active[0] ?? null };
  }
  async start(routeId: string, user: AuthenticatedUser) {
    const routes = await this.db.query(`SELECT id,site_id FROM routes WHERE id=$1 AND is_active`, [routeId]);
    if (!routes[0]) throw new NotFoundException('Ruta no disponible');
    await this.scope(routes[0].site_id, user);
    const policy = await this.gps.policy(user.sub, routes[0].site_id);
    if (!policy.consent.granted) throw new ForbiddenException('Acepta el aviso de geolocalización antes de capturar.');
    const points = await this.db.query<Point[]>(`SELECT c.id,c.name,rc.position,
      coalesce(array_agg(t.uid) FILTER(WHERE t.uid IS NOT NULL),'{}') AS uids
      FROM route_checkpoints rc JOIN checkpoints c ON c.tenant_id=rc.tenant_id AND c.id=rc.checkpoint_id
      LEFT JOIN tags t ON t.tenant_id=c.tenant_id AND t.checkpoint_id=c.id AND t.tech='nfc' AND t.is_active
      WHERE rc.route_id=$1 GROUP BY c.id,rc.position ORDER BY rc.position`, [routeId]);
    if (points.length < 2 || points.some(p => !p.uids.length)) throw new ConflictException('Instala las etiquetas NFC en todos los puntos de la ruta antes de comenzar.');
    const rules = await this.rules.effective({ siteId: routes[0].site_id });
    await this.db.query(`UPDATE reference_walks SET status='cancelled',ended_at=deadline WHERE operator_id=$1 AND status='recording' AND deadline<now()`, [user.sub]);
    const existing = await this.db.query(`SELECT id FROM reference_walks WHERE operator_id=$1 AND status='recording'`,[user.sub]);
    if (existing.length) throw new ConflictException('Ya tienes una ronda patrón activa. Retómala o cancélala.');
    const rows = await this.db.query(`INSERT INTO reference_walks(tenant_id,site_id,route_id,operator_id,checkpoints,target_accuracy_m,deadline)
      VALUES(app_tenant_id(),$1,$2,$3,$4::jsonb,$5,now()+make_interval(mins=>$6)) RETURNING *`,
      [routes[0].site_id, routeId,user.sub,JSON.stringify(points), rules.referenceGpsTargetAccuracyM,rules.referenceCaptureMaxMinutes]);
    return rows[0];
  }
  private async own(id: string, user: AuthenticatedUser): Promise<Walk> {
    const rows = await this.db.query<Walk[]>('SELECT * FROM reference_walks WHERE id=$1 FOR UPDATE',[id]);
    const walk = rows[0];
    if (!walk || walk.operator_id !== user.sub) throw new NotFoundException('Captura no disponible');
    await this.scope(walk.site_id,user); return walk;
  }
  private time(w: Walk, at: string) {
    const ms = Date.parse(at);
    if (ms < new Date(w.started_at).getTime()-5000 || ms > new Date(w.deadline).getTime() || ms > Date.now()+5000)
      throw new ConflictException('La muestra está fuera de la ventana de captura.');
  }
  async samples(id: string, points: ReferencePointDto[], user: AuthenticatedUser) {
    const w = await this.own(id,user);
    if (!(await this.gps.policy(user.sub,w.site_id)).consent.granted) throw new ForbiddenException('Se retiró el consentimiento GPS. La captura debe detenerse.');
    for (const p of points) {
      const existing = await this.db.query('SELECT client_point_id FROM reference_samples WHERE walk_id=$1 AND client_point_id=$2',[id,p.clientPointId]);
      if (existing.length) continue;
      if (w.status !== 'recording') throw new ConflictException('La captura ya terminó');
      this.time(w,p.recordedAt);
      await this.db.query(`INSERT INTO reference_samples(tenant_id,walk_id,client_point_id,recorded_at,point)
        VALUES(app_tenant_id(),$1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,[id,p.clientPointId,p.recordedAt,JSON.stringify(p)]);
    }
    return { acknowledged: points.map(p=>p.clientPointId) };
  }
  async scan(id: string, input: ReferenceScanDto, user: AuthenticatedUser) {
    const w = await this.own(id,user);
    const existing = await this.db.query('SELECT * FROM reference_scans WHERE walk_id=$1 AND client_scan_id=$2',[id,input.clientScanId]);
    if (existing[0]) return existing[0];
    if (w.status !== 'recording') throw new ConflictException('La captura ya terminó');
    this.time(w,input.scannedAt);
    const point = w.checkpoints.find(p=>p.uids.includes(input.uid));
    if (!point) throw new ConflictException('La etiqueta no pertenece a esta ronda patrón.');
    const rows = await this.db.query(`INSERT INTO reference_scans(tenant_id,walk_id,client_scan_id,checkpoint_id,scanned_at)
      VALUES(app_tenant_id(),$1,$2,$3,$4) RETURNING *`,[id,input.clientScanId,point.id,input.scannedAt]);
    return rows[0];
  }
  async detail(id: string, user: AuthenticatedUser) {
    const walk=await this.own(id,user);
    const samples=await this.db.query<Array<{point: ReferencePointDto}>>('SELECT point FROM reference_samples WHERE walk_id=$1 ORDER BY recorded_at',[id]);
    const scans=await this.db.query('SELECT * FROM reference_scans WHERE walk_id=$1 ORDER BY scanned_at',[id]);
    const checkpoints=walk.checkpoints.map(cp=>{
      const observations=scans.filter((s: { checkpoint_id: string })=>s.checkpoint_id===cp.id);
      const candidates=samples.map(s=>s.point).filter(p=>observations.some((s: {scanned_at: Date})=>Math.abs(Date.parse(p.recordedAt)-new Date(s.scanned_at).getTime())<=6000));
      const stable=candidates.filter(p=>p.stationary && p.accelSamples>=20 && p.gyroSamples>=20);
      const group=(stable.length?stable:candidates).sort((a,b)=>a.accuracyM-b.accuracyM).slice(0,5);
      const best=group[0];
      const good=best ? group.filter(p=>{
        const lat=(p.latitude-best.latitude)*Math.PI/180,lng=(p.longitude-best.longitude)*Math.PI/180;
        const a=Math.sin(lat/2)**2+Math.cos(p.latitude*Math.PI/180)*Math.cos(best.latitude*Math.PI/180)*Math.sin(lng/2)**2;
        const distance=12742000*Math.asin(Math.min(1,Math.sqrt(a)));
        return p.accuracyM<=Math.max(best.accuracyM*1.5,walk.target_accuracy_m) && distance<=Math.max(best.accuracyM+p.accuracyM,walk.target_accuracy_m*2);
      }) : [];
      const weight=good.reduce((a,p)=>a+1/(p.accuracyM*p.accuracyM),0);
      return { id:cp.id,name:cp.name,position:cp.position,scans:observations.length,
        estimate: best ? { latitude:good.reduce((a,p)=>a+p.latitude/(p.accuracyM*p.accuracyM),0)/weight,
          longitude:good.reduce((a,p)=>a+p.longitude/(p.accuracyM*p.accuracyM),0)/weight,
          accuracyM:Math.max(...good.map(p=>p.accuracyM)),samples:good.length,stationary:stable.length>0 } : null };
    });
    return { walk,checkpoints,points:samples.map(s=>s.point) };
  }
  async finish(id: string, user: AuthenticatedUser, cancel=false) {
    const data=await this.detail(id,user);
    if (data.walk.status!=='recording') return data;
    if (!cancel && (data.points.length<2 || data.checkpoints.some(p=>!p.estimate || p.estimate.accuracyM>data.walk.target_accuracy_m)))
      throw new ConflictException('Falta escanear puntos con la precisión objetivo. Revisa los puntos marcados y vuelve a escanearlos.');
    await this.db.query(`UPDATE reference_walks SET status=$2,ended_at=least(now(),deadline) WHERE id=$1`,[id,cancel?'cancelled':'completed']);
    return this.detail(id,user);
  }
}
