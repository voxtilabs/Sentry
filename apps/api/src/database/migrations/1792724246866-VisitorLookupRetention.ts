import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Conserva el resultado asíncrono mientras una visita retenga su solicitud original. */
export class VisitorLookupRetention1792724246866 implements MigrationInterface {
  name='VisitorLookupRetention1792724246866';
  async up(runner:QueryRunner):Promise<void> {await this.replace(runner,true);}
  async down(runner:QueryRunner):Promise<void> {await this.replace(runner,false);}
  private async replace(runner:QueryRunner,keepAsyncResult:boolean):Promise<void> {
    await runner.query(`CREATE OR REPLACE FUNCTION retencion_purgar_visitas(empresa uuid,dias integer,lote integer)
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      DECLARE borradas integer;
      BEGIN
        IF public.app_tenant_id() IS NOT NULL OR dias<1 OR dias>90 OR lote<1 OR lote>5000 THEN
          RAISE EXCEPTION 'Contexto de purga no permitido' USING ERRCODE='42501';
        END IF;
        PERFORM set_config('app.tenant_id',empresa::text,true);
        DELETE FROM public.visitor_sessions WHERE tenant_id=empresa AND id IN
          (SELECT id FROM public.visitor_sessions WHERE tenant_id=empresa AND created_at<now()-make_interval(days=>dias)
           ORDER BY created_at LIMIT lote);
        GET DIAGNOSTICS borradas=ROW_COUNT;
        DELETE FROM public.visitor_vehicle_checks c WHERE c.tenant_id=empresa AND c.id IN
          (SELECT x.id FROM public.visitor_vehicle_checks x WHERE x.tenant_id=empresa AND x.created_at<now()-make_interval(days=>dias)
           AND NOT EXISTS(SELECT 1 FROM public.visitor_sessions v WHERE v.tenant_id=empresa AND v.vehicle_check_id=x.id)
           ${keepAsyncResult ? `AND NOT EXISTS(SELECT 1 FROM public.visitor_sessions v
             JOIN public.visitor_vehicle_checks original ON original.tenant_id=v.tenant_id AND original.id=v.vehicle_check_id
             WHERE v.tenant_id=empresa AND original.result->>'lookupResultId'=x.id::text)` : ''}
           ORDER BY x.created_at LIMIT lote);
        PERFORM set_config('app.tenant_id','',true);
        RETURN borradas;
      END $$`);
  }
}
