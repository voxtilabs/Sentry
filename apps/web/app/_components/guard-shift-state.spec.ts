/**
 * La foto obligatoria del punto, vista desde el teléfono.
 *
 * Lo que se prueba acá es que la pantalla de terreno DECIDE con la función de
 * `@sentrycore/shared` y no con una regla propia, y que la deuda de evidencia
 * —marcado sin foto— no se pierde ni se perdona sola.
 *
 * Es lógica pura: sin jsdom, sin testing-library. Lo que se renderiza se mira
 * en el navegador; lo que se decide, acá.
 */

import { isPhotoRequired } from '@sentrycore/shared';

import {
  aplicarVeredictos,
  estadoInicial,
  sePuedeSaltar,
  siguientePunto,
  hayPendientesDeSubir,
  marcarFotoPuntoSubida,
  puntoExigeFoto,
  puntosSinFoto,
  registrarEscaneo,
  type PoliticaFoto,
  type PuntoRuta,
} from './guard-shift-state';

const punto = (extra: Partial<PuntoRuta> = {}): PuntoRuta => ({
  id: 'cp-1',
  name: 'Portería',
  position: 1,
  kind: 'normal',
  requiresPhoto: null,
  ...extra,
});

const politica = (
  withinBusinessHours: boolean,
  rules: Partial<PoliticaFoto['rules']> = {},
): PoliticaFoto => ({
  withinBusinessHours,
  rules: {
    photoRequiredOutsideHours: true,
    photoRequiredOnCritical: true,
    ...rules,
  },
});

describe('puntoExigeFoto', () => {
  it('un acceso crítico exige foto aunque el recinto esté abierto', () => {
    expect(puntoExigeFoto(punto({ kind: 'acceso_critico' }), politica(true))).toBe(true);
  });

  it('un punto normal en horario hábil no exige foto', () => {
    expect(puntoExigeFoto(punto(), politica(true))).toBe(false);
  });

  it('fuera de horario la exige en todo punto', () => {
    expect(puntoExigeFoto(punto(), politica(false))).toBe(true);
  });

  it('el override del punto manda sobre horario y reglas, en las dos direcciones', () => {
    expect(puntoExigeFoto(punto({ requiresPhoto: false }), politica(false))).toBe(false);
    expect(puntoExigeFoto(punto({ requiresPhoto: true }), politica(true))).toBe(true);
  });

  it('respeta que la empresa apague la foto en accesos críticos', () => {
    const sinFotoEnCriticos = politica(true, { photoRequiredOnCritical: false });
    expect(puntoExigeFoto(punto({ kind: 'acceso_critico' }), sinFotoEnCriticos)).toBe(false);
  });

  /**
   * Es la razón de existir de esta función: adaptar la forma del punto y
   * delegar. Si alguien reimplementa la decisión acá, este test lo agarra
   * porque compara contra la fuente, no contra un valor esperado escrito a mano.
   */
  it('no reimplementa la regla: delega en isPhotoRequired() de @sentrycore/shared', () => {
    const casos: Array<[PuntoRuta, PoliticaFoto]> = [
      [punto(), politica(true)],
      [punto(), politica(false)],
      [punto({ kind: 'acceso_critico' }), politica(true)],
      [punto({ requiresPhoto: false }), politica(false)],
      [punto({ requiresPhoto: true }), politica(true)],
      [punto({ kind: 'acceso_critico' }), politica(false, { photoRequiredOnCritical: false })],
    ];

    for (const [candidato, reglas] of casos) {
      expect(puntoExigeFoto(candidato, reglas)).toBe(
        isPhotoRequired({
          checkpoint: {
            kind: candidato.kind ?? 'normal',
            requiresPhoto: candidato.requiresPhoto ?? null,
          },
          withinBusinessHours: reglas.withinBusinessHours,
          rules: reglas.rules,
        }),
      );
    }
  });

  /**
   * API vieja frente a un portal nuevo. Se asume horario hábil: siguen pidiendo
   * foto los accesos críticos y los puntos con override —el mínimo que promete
   * el producto— en vez de pedirla en los 40 puntos de la ronda.
   */
  it('sin política sigue exigiendo la foto del acceso crítico', () => {
    expect(puntoExigeFoto(punto({ kind: 'acceso_critico' }))).toBe(true);
    expect(puntoExigeFoto(punto({ requiresPhoto: true }))).toBe(true);
    expect(puntoExigeFoto(punto())).toBe(false);
  });

  it('un punto sin criticidad —API vieja— cuenta como normal y no rompe', () => {
    expect(puntoExigeFoto({ id: 'cp-9', name: 'Bodega', position: 9 }, politica(true))).toBe(false);
  });
});

describe('deuda de evidencia del turno', () => {
  const PUNTOS = [punto({ id: 'cp-1', kind: 'acceso_critico' }), punto({ id: 'cp-2', position: 2 })];

  const conEscaneo = (fotoRequerida: boolean) =>
    registrarEscaneo(estadoInicial('patrol-1'), {
      checkpointId: 'cp-1',
      clientScanId: 'cli-1',
      anomalias: [],
      confirmado: true,
      scannedAt: '2026-08-05T03:00:00.000Z',
      metodo: 'nfc',
      fotoRequerida,
      scanId: 'scan-1',
    });

  it('un punto marcado sin su foto queda listado, con nombre y posición', () => {
    expect(puntosSinFoto(PUNTOS, conEscaneo(true).puntos).map((p) => p.id)).toEqual(['cp-1']);
  });

  it('con la foto arriba deja de estar en deuda', () => {
    const estado = marcarFotoPuntoSubida(conEscaneo(true), 'cli-1', true);
    expect(puntosSinFoto(PUNTOS, estado.puntos)).toHaveLength(0);
  });

  it('un punto que no exigía foto nunca entra en la deuda', () => {
    expect(puntosSinFoto(PUNTOS, conEscaneo(false).puntos)).toHaveLength(0);
  });

  it('los puntos sin escanear no cuentan como foto faltante: eso es otra cosa', () => {
    expect(puntosSinFoto(PUNTOS, estadoInicial('patrol-1').puntos)).toHaveLength(0);
  });

  /**
   * La foto que el guardia nunca llegó a tomar es deuda de evidencia, no algo
   * esperando en la cola: si contara como pendiente de subir, el turno no se
   * podría cerrar nunca y el estado local quedaría pegado para siempre. Lo que
   * sí espera —la foto tomada y sin subir— lo cuenta el almacén de fotos.
   */
  it('la foto que falta no bloquea el cierre del turno: se muestra, no se cuenta', () => {
    expect(hayPendientesDeSubir(conEscaneo(true))).toBe(false);
    expect(puntosSinFoto(PUNTOS, conEscaneo(true).puntos)).toHaveLength(1);
  });
});

describe('aplicarVeredictos y la foto del escaneo encolado', () => {
  const encolado = registrarEscaneo(estadoInicial('patrol-1'), {
    checkpointId: 'cp-1',
    clientScanId: 'cli-1',
    anomalias: [],
    confirmado: false,
    scannedAt: '2026-08-05T03:00:00.000Z',
    metodo: 'nfc',
    fotoRequerida: true,
  });

  it('el serverId del veredicto queda como scanId: es donde se cuelga la foto', () => {
    const estado = aplicarVeredictos(encolado, [
      { clientId: 'cli-1', status: 'aplicado', serverId: 'scan-99' },
    ]);
    expect(estado.puntos['cp-1']).toMatchObject({ confirmado: true, scanId: 'scan-99' });
  });

  it('un duplicado confirma igual: la foto se cuelga del escaneo que ya existía', () => {
    const estado = aplicarVeredictos(encolado, [
      { clientId: 'cli-1', status: 'duplicado', serverId: 'scan-original' },
    ]);
    expect(estado.puntos['cp-1']).toMatchObject({ confirmado: true, scanId: 'scan-original' });
  });

  it('un escaneo rechazado se lleva el punto y su deuda de foto', () => {
    const estado = aplicarVeredictos(encolado, [{ clientId: 'cli-1', status: 'rechazado' }]);
    expect(estado.puntos['cp-1']).toBeUndefined();
    expect(hayPendientesDeSubir(estado)).toBe(false);
  });

  it('mientras el escaneo no sincroniza, sigue siendo trabajo por subir', () => {
    expect(hayPendientesDeSubir(encolado)).toBe(true);
  });
});

describe('dejar un punto para después (reporte de terreno del 21-09-2026)', () => {
  /*
   * Bruno: «si hay un error en el punto 6 no podemos pasar directo al
   * siguiente, hay que devolverse — ese punto es línea recta hacia el fondo y
   * luego devolverse y hacer como una U».
   *
   * El 6 está al fondo de un pasillo sin salida. Si el escaneo falla ahí, la
   * pantalla seguía pidiendo el 6 y el guardia, que ya caminó de vuelta, tenía
   * que rehacer el pasillo entero para obedecerla.
   */
  const ruta = (cuantos: number) =>
    Array.from({ length: cuantos }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Punto ${i + 1}`,
      position: i + 1,
    }));

  const marcados = (ids: readonly string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        { checkpointId: id, clientScanId: id, anomalias: [], confirmado: true },
      ]),
    ) as never;

  it('saltado el 6, el siguiente es el 7 y no el 6 otra vez', () => {
    // El guardia viene del 5 y el 6 le fallo: lo que tiene delante es el 7.
    const siguiente = siguientePunto(ruta(8), marcados(['p1', 'p2', 'p3', 'p4', 'p5']), ['p6']);
    expect(siguiente?.id).toBe('p7');
  });

  it('el punto saltado NO desaparece: vuelve cuando ya no queda otro', () => {
    // Si se perdiera, la ronda cerraría "completa" con un punto que nadie pisó.
    const siguiente = siguientePunto(
      ruta(8),
      marcados(['p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p8']),
      ['p6'],
    );
    expect(siguiente?.id).toBe('p6');
  });

  it('el orden de la ruta manda mientras no se salte nada', () => {
    expect(siguientePunto(ruta(8), {}, [])?.id).toBe('p1');
  });

  it('saltar se ofrece solo si hay otro punto al que ir', () => {
    const puntos = ruta(8);
    expect(sePuedeSaltar(puntos, {}, [], puntos[5])).toBe(true);
  });

  it('en el último pendiente no se ofrece: no hay a dónde seguir', () => {
    const puntos = ruta(2);
    expect(sePuedeSaltar(puntos, marcados(['p1']), [], puntos[1])).toBe(false);
  });

  it('tampoco se ofrece cuando lo único que queda ya está saltado', () => {
    // Saltar el último pendiente lo devolvería a sí mismo: un botón que no hace
    // nada es peor que ninguno cuando el guardia está en la calle.
    const puntos = ruta(3);
    expect(sePuedeSaltar(puntos, marcados(['p1']), ['p3'], puntos[1])).toBe(false);
  });
});
