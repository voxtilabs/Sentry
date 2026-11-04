import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ReferenceRetention1793327701000 implements MigrationInterface {
  name='ReferenceRetention1793327701000';
  async up(q:QueryRunner):Promise<void>{
    await q.query(`CREATE FUNCTION retencion_purgar_referencia(empresa uuid,dias integer,lote integer)
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      DECLARE ids uuid[]; borradas integer;
      BEGIN
        IF public.app_tenant_id() IS NOT NULL OR dias<1 OR dias>3650 OR lote<1 OR lote>50 THEN
          RAISE EXCEPTION 'Contexto de purga no permitido' USING ERRCODE='42501';
        END IF;
        PERFORM set_config('app.tenant_id',empresa::text,true);
        SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.reference_walks
          WHERE tenant_id=empresa AND deadline<now()-make_interval(days=>dias) ORDER BY deadline LIMIT lote) viejas;
        DELETE FROM public.reference_samples WHERE tenant_id=empresa AND walk_id=ANY(ids);
        GET DIAGNOSTICS borradas=ROW_COUNT;
        DELETE FROM public.reference_scans WHERE tenant_id=empresa AND walk_id=ANY(ids);
        DELETE FROM public.reference_walks WHERE tenant_id=empresa AND id=ANY(ids);
        RETURN borradas;
      END $$`);
    await q.query('REVOKE ALL ON FUNCTION retencion_purgar_referencia(uuid,integer,integer) FROM PUBLIC');
    await q.query('GRANT EXECUTE ON FUNCTION retencion_purgar_referencia(uuid,integer,integer) TO sentrycore_app');
  }
  async down(q:QueryRunner):Promise<void>{await q.query('DROP FUNCTION retencion_purgar_referencia(uuid,integer,integer)')}
}
