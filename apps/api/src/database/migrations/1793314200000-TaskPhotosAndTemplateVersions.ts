import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Fotos múltiples y versiones: nunca reescribe preguntas ni respuestas históricas. */
export class TaskPhotosAndTemplateVersions1793314200000 implements MigrationInterface {
  name = 'TaskPhotosAndTemplateVersions1793314200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE checklist_items
      ADD COLUMN photo_min_count integer,
      ADD COLUMN photo_max_count integer,
      ADD CONSTRAINT checklist_items_photo_counts_check CHECK (
        (photo_min_count IS NULL OR photo_min_count BETWEEN 1 AND 10) AND
        (photo_max_count IS NULL OR photo_max_count BETWEEN 1 AND 10) AND
        (photo_min_count IS NULL OR photo_max_count IS NULL OR photo_min_count <= photo_max_count)
      ),
      DROP CONSTRAINT checklist_items_response_type_check,
      ADD CONSTRAINT checklist_items_response_type_check
        CHECK (response_type IN ('ok_falla', 'si_no', 'texto', 'numero', 'foto'))`);
    await runner.query(`ALTER TABLE patrols ADD COLUMN checklist_template_id uuid,
      ADD CONSTRAINT patrols_checklist_template_fk FOREIGN KEY (tenant_id, checklist_template_id)
        REFERENCES checklist_templates(tenant_id, id) ON DELETE RESTRICT`);
    await runner.query(`CREATE INDEX patrols_checklist_template_idx
      ON patrols(tenant_id, checklist_template_id) WHERE checklist_template_id IS NOT NULL`);

    // RLS permanece activo durante el backfill. Cada vuelta tiene contexto de UNA empresa.
    await runner.query(`DO $$ DECLARE empresa uuid; BEGIN
      FOR empresa IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', empresa::text, true);
        UPDATE patrols p SET checklist_template_id = COALESCE(
          (SELECT i.template_id FROM checklist_responses r
            JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id
            WHERE r.tenant_id=empresa AND r.patrol_id=p.id
            GROUP BY i.template_id ORDER BY count(*) DESC, i.template_id LIMIT 1),
          (SELECT t.id FROM checklist_templates t
            LEFT JOIN shift_assignments a ON a.tenant_id=p.tenant_id AND a.id=p.shift_assignment_id
            WHERE t.tenant_id=empresa AND t.is_active
              AND p.status IN ('pendiente','en_curso','pausada')
              AND (t.site_id IS NULL OR t.site_id=p.site_id)
              AND (t.shift_id IS NULL OR t.shift_id=a.shift_id)
            ORDER BY (t.site_id IS NOT NULL)::int + (t.shift_id IS NOT NULL)::int DESC LIMIT 1)
        ) WHERE p.tenant_id=empresa;
      END LOOP;
      PERFORM set_config('app.tenant_id', '', true);
    END $$`);

    await runner.query(`CREATE TABLE checklist_response_photos (
      tenant_id uuid NOT NULL,
      response_id uuid NOT NULL,
      photo_id uuid NOT NULL,
      position integer NOT NULL CHECK (position BETWEEN 1 AND 10),
      PRIMARY KEY (tenant_id, response_id, photo_id),
      UNIQUE (tenant_id, response_id, position),
      FOREIGN KEY (tenant_id, response_id) REFERENCES checklist_responses(tenant_id,id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, photo_id) REFERENCES scan_photos(tenant_id,id) ON DELETE CASCADE
    )`);
    await runner.query(`CREATE INDEX checklist_response_photos_photo_idx ON checklist_response_photos(tenant_id, photo_id)`);
    await runner.query(`ALTER TABLE checklist_response_photos ENABLE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE checklist_response_photos FORCE ROW LEVEL SECURITY`);
    await runner.query(`CREATE POLICY checklist_response_photos_isolation ON checklist_response_photos
      USING (tenant_id=app_tenant_id() OR app_has_audited_support_access(tenant_id))
      WITH CHECK (tenant_id=app_tenant_id())`);
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sentrycore_app') THEN
      GRANT SELECT, INSERT ON checklist_response_photos TO sentrycore_app;
      REVOKE UPDATE, DELETE ON checklist_response_photos FROM sentrycore_app;
    END IF; END $$`);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Una reversión no puede descartar silenciosamente tipos que la versión antigua no comprende.
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM checklist_items WHERE response_type IN ('si_no','foto')) THEN
      RAISE EXCEPTION 'Existen tareas de la versión nueva; conserva la migración al volver al servidor anterior';
    END IF; END $$`);
    await runner.query(`DROP TABLE checklist_response_photos`);
    await runner.query(`ALTER TABLE patrols DROP COLUMN checklist_template_id`);
    await runner.query(`ALTER TABLE checklist_items DROP COLUMN photo_min_count, DROP COLUMN photo_max_count,
      DROP CONSTRAINT checklist_items_response_type_check,
      ADD CONSTRAINT checklist_items_response_type_check CHECK (response_type IN ('ok_falla','texto','numero'))`);
  }
}
