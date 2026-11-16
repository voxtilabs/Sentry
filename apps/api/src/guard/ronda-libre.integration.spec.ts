import { DataSource } from 'typeorm';

/*
 * El alta de la ruta de recorrido libre, contra PostgreSQL DE VERDAD.
 *
 * ESTE SPEC EXISTE PORQUE EL 500 LLEGO A PRODUCCION. Las pruebas unitarias
 * simulan el `manager.query`, asi que ven la CADENA del INSERT pero no el
 * esquema: `routes.estimated_duration_min` es NOT NULL con CHECK > 0, el
 * INSERT la omitia, y nada lo noto hasta que un guardia apreto el boton.
 *
 * Misma familia que consulta-home.integration.spec.ts: la unica autoridad
 * sobre lo que la base acepta es la base. Corre solo donde hay una: en CI.
 */
const testUrl = process.env.DATABASE_TEST_URL;
const describeDatabase = testUrl ? describe : describe.skip;

describeDatabase('la ruta de recorrido libre se puede crear de verdad', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: testUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('el INSERT trae TODAS las columnas obligatorias de routes', async () => {
    /*
     * Se comprueba contra el esquema y no ejecutando el INSERT: montar un
     * tenant, un recinto y el contexto RLS para una sola fila seria mas
     * maquinaria que la que se esta probando. Lo que fallo fue omitir una
     * columna obligatoria, y eso se ve aqui entero.
     */
    const obligatorias = await dataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'routes'
          AND is_nullable = 'NO'
          AND column_default IS NULL`,
    );

    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fuente = readFileSync(join(__dirname, 'guard.service.ts'), 'utf8');
    const insert = /INSERT INTO routes \(([\s\S]*?)\)\s*\n\s*VALUES/.exec(fuente);
    expect(insert?.[1]).toBeDefined();
    const declaradas = (insert?.[1] ?? '').split(',').map((c) => c.trim());

    const faltantes = obligatorias
      .map((c) => c.column_name)
      .filter((c) => !declaradas.includes(c));

    expect(faltantes).toEqual([]);
  });

  it('el UPDATE de cierre usa columnas que existen de verdad', async () => {
    /*
     * Fallo en produccion con 42703: el UPDATE decia `ended_at`, que no existe
     * —la columna se llama `closed_at`—. El guardia quedaba con una ronda
     * abierta que no podia cerrar ni reemplazar, y la traza siguiendo.
     *
     * Las pruebas unitarias comprueban que el SQL CONTENGA cierto texto: eso
     * pasa igual con una columna inventada.
     */
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fuente = readFileSync(join(__dirname, 'guard.service.ts'), 'utf8');
    const update = /UPDATE patrols\n\s*SET ([\s\S]*?)\n\s*WHERE id = \$1 AND status = 'en_curso'/.exec(
      fuente,
    );
    expect(update?.[1]).toBeDefined();

    const usadas = [...(update?.[1] ?? '').matchAll(/(\w+)\s*=/g)].map((m) => m[1] as string);
    expect(usadas.length).toBeGreaterThan(1);

    const reales = await dataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'patrols'`,
    );
    const nombres = reales.map((c) => c.column_name);
    const inventadas = usadas.filter((c) => !nombres.includes(c));

    expect(inventadas).toEqual([]);
  });

  it('la columna is_free_roam existe y su indice unico tambien', async () => {
    const columnas = await dataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'routes' AND column_name = 'is_free_roam'`,
    );
    expect(columnas).toHaveLength(1);

    // Una sola ruta libre por recinto: con dos, el guardia veria dos botones
    // iguales y sus recorridos quedarian repartidos sin que nada lo explique.
    const indices = await dataSource.query<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'routes' AND indexname = 'routes_free_roam_unica_por_recinto'`,
    );
    expect(indices).toHaveLength(1);
  });
});
