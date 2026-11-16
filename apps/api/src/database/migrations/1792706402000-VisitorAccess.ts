import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Portería separada del dominio de rondas. No se almacenan imágenes ni texto OCR. */
export class VisitorAccess1792706402000 implements MigrationInterface {
  name = 'VisitorAccess1792706402000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`INSERT INTO permissions(key,description) VALUES('visitors:register','Registrar ingresos y salidas de visitas'),('visitors:read','Consultar visitas en recintos autorizados') ON CONFLICT(key) DO NOTHING`);
    await runner.query(`INSERT INTO role_permissions(role_key,permission_key) VALUES('GUARDIA','visitors:register'),('ADMIN','visitors:read'),('SUPERVISOR','visitors:read') ON CONFLICT DO NOTHING`);
    await runner.query(`CREATE TABLE visitor_vehicle_checks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
      site_id uuid NOT NULL,guard_id uuid NOT NULL,plate text NOT NULL,
      result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,site_id) REFERENCES sites(tenant_id,id) ON DELETE CASCADE,
      FOREIGN KEY(tenant_id,guard_id) REFERENCES memberships(tenant_id,user_id) ON DELETE RESTRICT,
      CONSTRAINT visitor_vehicle_checks_plate_check CHECK(plate ~ '^[A-Z0-9]{5,6}$'),
      CONSTRAINT visitor_vehicle_checks_result_check CHECK(jsonb_typeof(result)='object')
    )`);
    await runner.query(`CREATE TABLE visitor_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
      site_id uuid NOT NULL,guard_id uuid NOT NULL,client_visit_id uuid NOT NULL,
      given_names text NOT NULL,family_names text NOT NULL,run text NOT NULL,
      entered_at_device timestamptz NOT NULL,entered_at_server timestamptz NOT NULL DEFAULT now(),
      exited_at_device timestamptz,exited_at_server timestamptz,exit_guard_id uuid,
      arrives_in_vehicle boolean NOT NULL,plate text,vehicle_check_id uuid,
      vehicle_make text,vehicle_model text,vehicle_color text,destination text,origin_company text,
      notice_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,id),UNIQUE(tenant_id,guard_id,client_visit_id),
      FOREIGN KEY(tenant_id,site_id) REFERENCES sites(tenant_id,id) ON DELETE CASCADE,
      FOREIGN KEY(tenant_id,guard_id) REFERENCES memberships(tenant_id,user_id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,exit_guard_id) REFERENCES memberships(tenant_id,user_id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,vehicle_check_id) REFERENCES visitor_vehicle_checks(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT visitor_sessions_given_names_check CHECK(length(trim(given_names)) BETWEEN 1 AND 120),
      CONSTRAINT visitor_sessions_family_names_check CHECK(length(trim(family_names)) BETWEEN 1 AND 120),
      CONSTRAINT visitor_sessions_run_check CHECK(run ~ '^[0-9]{6,8}-[0-9K]$'),
      CONSTRAINT visitor_sessions_plate_check CHECK((arrives_in_vehicle AND plate IS NOT NULL AND plate ~ '^[A-Z0-9]{5,6}$') OR
        (NOT arrives_in_vehicle AND plate IS NULL AND vehicle_check_id IS NULL AND vehicle_make IS NULL AND vehicle_model IS NULL AND vehicle_color IS NULL)),
      CONSTRAINT visitor_sessions_exit_check CHECK(exited_at_device IS NULL OR exited_at_device>=entered_at_device),
      CONSTRAINT visitor_sessions_vehicle_make_check CHECK(vehicle_make IS NULL OR length(vehicle_make)<=80),
      CONSTRAINT visitor_sessions_vehicle_model_check CHECK(vehicle_model IS NULL OR length(vehicle_model)<=120),
      CONSTRAINT visitor_sessions_vehicle_color_check CHECK(vehicle_color IS NULL OR length(vehicle_color)<=80),
      CONSTRAINT visitor_sessions_destination_check CHECK(destination IS NULL OR length(destination)<=200),
      CONSTRAINT visitor_sessions_origin_company_check CHECK(origin_company IS NULL OR length(origin_company)<=160)
    )`);
    for (const table of ['visitor_sessions','visitor_vehicle_checks']) {
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await runner.query(`CREATE POLICY ${table}_isolation ON ${table} FOR ALL
        USING(tenant_id=app_tenant_id() OR app_has_audited_support_access(tenant_id))
        WITH CHECK(tenant_id=app_tenant_id())`);
      await runner.query(`REVOKE ALL ON ${table} FROM sentrycore_app`);
      await runner.query(`GRANT SELECT,INSERT ON ${table} TO sentrycore_app`);
      await runner.query(`CREATE INDEX ${table}_site_idx ON ${table}(tenant_id,site_id,created_at DESC)`);
    }
    // Datos de identidad inmutables para la aplicación; solo se puede registrar la salida.
    await runner.query(`GRANT UPDATE(exited_at_device,exited_at_server,exit_guard_id) ON visitor_sessions TO sentrycore_app`);
    await runner.query(`ALTER TABLE sync_operations DROP CONSTRAINT sync_operations_kind_check`);
    await runner.query(`ALTER TABLE sync_operations ADD CONSTRAINT sync_operations_kind_check CHECK(kind IN('scan','event','visit','visit-exit'))`);
    await runner.query(`CREATE FUNCTION retencion_purgar_visitas(empresa uuid,dias integer,lote integer)
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
           ORDER BY x.created_at LIMIT lote);
        PERFORM set_config('app.tenant_id','',true);
        RETURN borradas;
      END $$`);
    await runner.query('REVOKE ALL ON FUNCTION retencion_purgar_visitas(uuid,integer,integer) FROM PUBLIC');
    await runner.query('GRANT EXECUTE ON FUNCTION retencion_purgar_visitas(uuid,integer,integer) TO sentrycore_app');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP FUNCTION retencion_purgar_visitas(uuid,integer,integer)');
    await runner.query('DROP TABLE visitor_sessions');
    await runner.query('DROP TABLE visitor_vehicle_checks');
    // No borrar bitácoras de operaciones ya sincronizadas al revertir.
  }
}
