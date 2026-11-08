import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pausar la ronda (#231).
 *
 * Pedido de terreno: el guardia tiene que poder detenerla —lo llaman, come,
 * entra a un subterraneo— y que quede CONSTANCIA de que estuvo pausada. Sin
 * esto solo caben dos salidas, ambas mentirosas: dejarla corriendo, y el
 * informe acredita un tiempo en que nadie recorrio; o cerrarla incompleta, y
 * pierde lo que ya llevaba marcado.
 *
 * DOS PIEZAS Y NO UNA. El estado `pausada` dice como esta AHORA; la tabla dice
 * QUE PASO. Con solo el estado, una ronda reanudada no deja rastro de haber
 * estado detenida y el informe vuelve a mentir por omision. Con solo la tabla,
 * hay que mirar la ultima fila para saber si esta corriendo — y eso lo consulta
 * el monitoreo en vivo cada pocos segundos.
 *
 * La pausa DETIENE la traza: se rastrea solo mientras la ronda esta en curso, y
 * una ronda pausada no lo esta. Esa regla no se negocia por comodidad.
 */
export class PausarRonda1727647200000 implements MigrationInterface {
  name = 'PausarRonda1727647200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE patrols DROP CONSTRAINT IF EXISTS patrols_status_check`);
    await queryRunner.query(`
      ALTER TABLE patrols ADD CONSTRAINT patrols_status_check
        CHECK (status IN ('pendiente', 'en_curso', 'pausada', 'completada', 'incompleta', 'vencida'))
    `);

    await queryRunner.query(`
      CREATE TABLE patrol_pauses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        patrol_id uuid NOT NULL,
        paused_at timestamptz NOT NULL DEFAULT now(),
        resumed_at timestamptz,
        /*
         * El motivo es del guardia y puede faltar: obligarlo haria que escriba
         * "a" para poder pausar, y un motivo inventado es peor que ninguno.
         */
        reason text CONSTRAINT patrol_pauses_reason_check
          CHECK (reason IS NULL OR length(trim(reason)) >= 3),
        CONSTRAINT patrol_pauses_orden_check CHECK (resumed_at IS NULL OR resumed_at >= paused_at),
        UNIQUE (tenant_id, id),
        FOREIGN KEY (tenant_id, patrol_id) REFERENCES patrols(tenant_id, id) ON DELETE CASCADE
      )
    `);

    /*
     * Una pausa abierta a la vez por ronda. Sin esto, dos toques al boton dejan
     * dos filas abiertas y el tiempo pausado se cuenta doble en el informe.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX patrol_pauses_una_abierta
        ON patrol_pauses (tenant_id, patrol_id) WHERE resumed_at IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX patrol_pauses_patrol_idx ON patrol_pauses (tenant_id, patrol_id)`,
    );

    /*
     * RLS FORCE como el resto: aplica tambien al duenio de la tabla, que es
     * justo con el que corre la API.
     */
    /*
     * Las dos consultas que ya contaban rondas ABIERTAS tienen que contar
     * tambien las pausadas, o `pausada` se convierte en un agujero:
     *
     * - `rondas_abandonadas` avisa de las que llevan horas sin cerrarse. Sin
     *   esto, una ronda pausada y olvidada deja de aparecer ahi justo cuando
     *   mas habria que avisarla.
     * - Las estadisticas diarias cuentan "abiertas" por dia. Sin esto, pausar
     *   una ronda la hace desaparecer del recuento y los numeros del supervisor
     *   dejan de sumar.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION rondas_abandonadas(
        horas_de_gracia integer DEFAULT 25,
        tope integer DEFAULT 200
      )
      RETURNS TABLE (tenant_id uuid, patrol_id uuid)
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT p.tenant_id, p.id
        FROM patrols p
        WHERE p.status IN ('pendiente', 'en_curso', 'pausada')
          AND COALESCE(p.started_at, p.scheduled_end_at)
              < now() - make_interval(hours => horas_de_gracia)
        -- Las mas viejas primero: son las que llevan mas tiempo mintiendo en el
        -- panel del supervisor.
        ORDER BY COALESCE(p.started_at, p.scheduled_end_at)
        LIMIT tope
      $$
    `);

    await queryRunner.query(`ALTER TABLE patrol_pauses ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE patrol_pauses FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY patrol_pauses_tenant ON patrol_pauses
        USING (tenant_id = app_tenant_id())
        WITH CHECK (tenant_id = app_tenant_id())
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Las pausadas vuelven a 'en_curso' ANTES de restaurar el CHECK viejo: si
     * no, la restriccion no se puede crear porque hay filas que la violan y el
     * revert falla a medias.
     */
    await queryRunner.query(`UPDATE patrols SET status = 'en_curso' WHERE status = 'pausada'`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION rondas_abandonadas(
        horas_de_gracia integer DEFAULT 25,
        tope integer DEFAULT 200
      )
      RETURNS TABLE (tenant_id uuid, patrol_id uuid)
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $$
        SELECT p.tenant_id, p.id
        FROM patrols p
        WHERE p.status IN ('pendiente', 'en_curso')
          AND COALESCE(p.started_at, p.scheduled_end_at)
              < now() - make_interval(hours => horas_de_gracia)
        ORDER BY COALESCE(p.started_at, p.scheduled_end_at)
        LIMIT tope
      $$
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS patrol_pauses`);
    await queryRunner.query(`ALTER TABLE patrols DROP CONSTRAINT IF EXISTS patrols_status_check`);
    await queryRunner.query(`
      ALTER TABLE patrols ADD CONSTRAINT patrols_status_check
        CHECK (status IN ('pendiente', 'en_curso', 'completada', 'incompleta', 'vencida'))
    `);
  }
}
