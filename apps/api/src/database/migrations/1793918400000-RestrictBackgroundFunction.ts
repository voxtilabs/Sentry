import type { MigrationInterface, QueryRunner } from 'typeorm';

/** El barrido conserva su acceso; PUBLIC no necesita cruzar empresas. */
export class RestrictBackgroundFunction1793918400000 implements MigrationInterface {
  name = 'RestrictBackgroundFunction1793918400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('REVOKE ALL ON FUNCTION rondas_abandonadas(integer, integer) FROM PUBLIC');
    await runner.query('GRANT EXECUTE ON FUNCTION rondas_abandonadas(integer, integer) TO sentrycore_app');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('GRANT EXECUTE ON FUNCTION rondas_abandonadas(integer, integer) TO PUBLIC');
  }
}
