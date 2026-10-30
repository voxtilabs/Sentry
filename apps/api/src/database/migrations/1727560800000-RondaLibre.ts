import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La ronda libre: el guardia sale a recorrer sin ruta asignada (#231).
 *
 * Pedido de terreno: hay casos excepcionales —un ruido, una alarma, una vuelta
 * fuera de lo planificado— en los que el guardia necesita que quede constancia
 * de por donde anduvo, sin que exista una ruta ni puntos que marcar. Aprieta un
 * boton, se registra el recorrido, y lo cierra cuando quiere.
 *
 * SE MODELA COMO UNA RUTA Y NO COMO UNA RONDA SIN RUTA. `patrols.route_id` es
 * NOT NULL y hay 64 lugares en la API que dan por hecho que una ronda tiene
 * ruta —informes, estadisticas, escalamiento, planificacion—. Hacerla opcional
 * obligaria a revisar los 64 y cada uno es una forma distinta de romper un
 * informe que un cliente recibe. Con una ruta de cero puntos, la traza, el
 * mapa, el PDF y la auditoria siguen colgando exactamente de donde ya colgaban.
 *
 * `is_free_roam` marca esa ruta para dos cosas: que no aparezca donde se eligen
 * rutas de verdad —ni al supervisor que planifica, ni al guardia que elige una
 * ronda voluntaria— y que el informe pueda decir que fue un recorrido libre y
 * no una ronda con cero cumplimiento.
 */
export class RondaLibre1727560800000 implements MigrationInterface {
  name = 'RondaLibre1727560800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE routes ADD COLUMN IF NOT EXISTS is_free_roam boolean NOT NULL DEFAULT false`,
    );

    /*
     * Una sola por recinto. Si se pudieran crear dos, el guardia veria dos
     * botones identicos y las rondas libres del mismo recinto quedarian
     * repartidas entre ambas sin que nada lo explique.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS routes_free_roam_unica_por_recinto
         ON routes (tenant_id, site_id) WHERE is_free_roam`,
    );

    /*
     * Una ruta de recorrido libre no lleva puntos: si alguien le agrega uno, la
     * app le pediria al guardia que marque algo que no existe en la pared. Se
     * impide en la base y no solo en el servicio, porque a `route_checkpoints`
     * tambien se le escribe desde la importacion masiva del admin.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION impedir_puntos_en_ronda_libre()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM routes
           WHERE tenant_id = NEW.tenant_id AND id = NEW.route_id AND is_free_roam
        ) THEN
          RAISE EXCEPTION 'una ruta de recorrido libre no admite puntos de control';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER route_checkpoints_sin_ronda_libre
        BEFORE INSERT OR UPDATE ON route_checkpoints
        FOR EACH ROW EXECUTE FUNCTION impedir_puntos_en_ronda_libre()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS route_checkpoints_sin_ronda_libre ON route_checkpoints`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS impedir_puntos_en_ronda_libre()`);
    await queryRunner.query(`DROP INDEX IF EXISTS routes_free_roam_unica_por_recinto`);
    /*
     * Las rutas de recorrido libre se borran al revertir: sin la columna no hay
     * forma de distinguirlas de una ruta normal vacia, y dejarlas convertiria
     * cada una en una ruta sin puntos que el supervisor veria sin entender.
     * Sus rondas caen con ellas por la clave foranea, que es lo correcto: son
     * recorridos sin puntos que ya no se podrian interpretar.
     */
    await queryRunner.query(`DELETE FROM routes WHERE is_free_roam`);
    await queryRunner.query(`ALTER TABLE routes DROP COLUMN IF EXISTS is_free_roam`);
  }
}
