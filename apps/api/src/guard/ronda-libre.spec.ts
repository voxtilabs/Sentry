/**
 * El recorrido libre: salir a rondar sin ruta ni puntos (#231).
 *
 * Lo que se prueba aqui es lo que puede hacer dano: que no se abra una segunda
 * ronda encima de otra, que el guardia no pueda cerrar a mano una ronda
 * ASIGNADA, y que cerrarlo apague la ronda —de eso depende que la traza deje de
 * registrar su posicion cuando volvio a su puesto—.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GpsPolicyService } from '../geo/gps-policy.service';
import type { EnvioInformeService } from '../reports/envio-informe.service';
import { GuardService } from './guard.service';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { EscalationService } from '../escalation/escalation.service';
import type { MailQueueService } from '../mail/mail-queue.service';
import type { RulesService } from '../rules/rules.service';

const vacio = <T>(v: T) => v;
const servicio = (query: jest.Mock) =>
  new GuardService(
    { manager: { query } } as unknown as TenantContextService,
    vacio({ enqueue: jest.fn() }) as unknown as MailQueueService,
    vacio({ effective: jest.fn() }) as unknown as RulesService,
    vacio({ notify: jest.fn() }) as unknown as EscalationService,
    vacio({ assertPatrolStartAllowed: jest.fn() }) as unknown as GpsPolicyService,
    vacio({ alCerrarRonda: jest.fn() }) as unknown as EnvioInformeService,
  );

const RECINTO = 'a0000000-0000-4000-8000-000000000003';
const GUARDIA = 'b0000000-0000-4000-8000-000000000009';
const RONDA = 'c0000000-0000-4000-8000-000000000001';

describe('iniciar un recorrido libre', () => {
  it('lo rechaza si el recinto no es del guardia', async () => {
    const query = jest.fn().mockResolvedValueOnce([]); // recinto no asignado
    await expect(servicio(query).startFreeRoamPatrol(GUARDIA, RECINTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lo rechaza si ya tiene una ronda abierta', async () => {
    // `home()` trae UNA sola: una segunda abierta queda invisible y los
    // escaneos irian a la que el telefono muestre, no a la que el guardia cree
    // estar haciendo.
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RECINTO }])
      .mockResolvedValueOnce([{ id: 'ronda-ya-abierta' }]);

    await expect(servicio(query).startFreeRoamPatrol(GUARDIA, RECINTO)).rejects.toThrow(
      /ya tienes una ronda abierta/i,
    );
  });

  it('reutiliza la ruta de recorrido libre del recinto si ya existe', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RECINTO }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ruta-libre-existente' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const r = await servicio(query).startFreeRoamPatrol(GUARDIA, RECINTO);

    expect(r.isFreeRoam).toBe(true);
    expect(r.status).toBe('en_curso');
    // No debe INSERTAR una ruta nueva si ya habia una.
    const inserts = query.mock.calls.filter((c) => /INSERT INTO routes/.test(String(c[0])));
    expect(inserts).toHaveLength(0);
  });

  it('la crea la primera vez, marcada como recorrido libre', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RECINTO }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 'ruta-recien-creada' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    await servicio(query).startFreeRoamPatrol(GUARDIA, RECINTO);

    const insert = query.mock.calls.find((c) => /INSERT INTO routes/.test(String(c[0])));
    expect(String(insert?.[0])).toMatch(/is_free_roam/);
    // Sin esto, dos guardias del mismo recinto apretando a la vez crearian dos.
    expect(String(insert?.[0])).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('la ronda queda voluntaria y sin puntos esperados', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RECINTO }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ruta-libre' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    await servicio(query).startFreeRoamPatrol(GUARDIA, RECINTO);

    const insert = query.mock.calls.find((c) => /INSERT INTO patrols/.test(String(c[0])));
    const sql = String(insert?.[0]);
    // Voluntaria: un recorrido sin puntos no se puede cumplir ni incumplir, y
    // promediarlo como 0% hundiria el cumplimiento del recinto.
    expect(sql).toMatch(/is_voluntary/);
    expect(sql).toMatch(/'\[\]'::jsonb/);
  });
});

describe('cerrar un recorrido libre', () => {
  it('no deja cerrar a mano una ronda ASIGNADA', async () => {
    // Seria darle al guardia la forma de terminar su turno sin recorrer: el
    // informe diria "completada" con la mitad de los puntos sin marcar.
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RONDA, status: 'en_curso', es_libre: false }]);

    await expect(servicio(query).finishFreeRoamPatrol(GUARDIA, RONDA)).rejects.toThrow(
      /solo un recorrido libre/i,
    );
  });

  it('no deja cerrar dos veces', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RONDA, status: 'completada', es_libre: true }]);

    await expect(servicio(query).finishFreeRoamPatrol(GUARDIA, RONDA)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('no deja cerrar la ronda de otro guardia', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);

    await expect(servicio(query).finishFreeRoamPatrol(GUARDIA, RONDA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lo cierra y apaga la ronda, que es lo que detiene la traza', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RONDA, status: 'en_curso', es_libre: true }])
      .mockResolvedValueOnce(undefined);

    const r = await servicio(query).finishFreeRoamPatrol(GUARDIA, RONDA);

    expect(r.status).toBe('completada');
    const update = query.mock.calls.find((c) => /UPDATE patrols/.test(String(c[0])));
    // La columna es `closed_at`: `ended_at` no existe y el UPDATE fallaba con
    // 42703 contra PostgreSQL real. Que las columnas EXISTAN lo comprueba
    // ronda-libre.integration.spec.ts, que sí tiene una base delante.
    expect(String(update?.[0])).toMatch(/closed_at = now\(\)/);
    // Sin esto, dos toques seguidos al boton cerrarian dos veces.
    expect(String(update?.[0])).toMatch(/status = 'en_curso'/);
  });
});

describe('terminar la ronda sin completar los puntos', () => {
  const reglas = { effective: jest.fn().mockResolvedValue({ complianceThreshold: 70 }) };
  const servicioConReglas = (query: jest.Mock) =>
    new GuardService(
      { manager: { query } } as unknown as TenantContextService,
      vacio({ enqueue: jest.fn() }) as unknown as MailQueueService,
      reglas as unknown as RulesService,
      vacio({ notify: jest.fn() }) as unknown as EscalationService,
      vacio({ assertPatrolStartAllowed: jest.fn() }) as unknown as GpsPolicyService,
      vacio({ alCerrarRonda: jest.fn() }) as unknown as EnvioInformeService,
    );

  it('NO la marca completada cuando faltan puntos: queda incompleta', async () => {
    // Es la diferencia entre darle una salida al guardia y darle una forma de
    // fingir que recorrio. El informe tiene que decir lo que paso.
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: RONDA, status: 'en_curso', site_id: RECINTO, expected_checkpoint_ids: ['p1', 'p2'] },
      ])
      .mockResolvedValueOnce([{ checkpoint_id: 'p1', anomalies: [] }])
      .mockResolvedValueOnce(undefined);

    const r = await servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA);

    expect(r.status).toBe('incompleta');
    expect(r.compliancePct).toBe(50);
    const update = query.mock.calls.find((c) => /UPDATE patrols/.test(String(c[0])));
    expect(String(update?.[0])).toMatch(/'incompleta'/);
  });

  it('guarda el cumplimiento REAL, no un cero de castigo', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: RONDA, status: 'en_curso', site_id: RECINTO, expected_checkpoint_ids: ['p1', 'p2', 'p3', 'p4'] },
      ])
      .mockResolvedValueOnce([
        { checkpoint_id: 'p1', anomalies: [] },
        { checkpoint_id: 'p2', anomalies: [] },
        { checkpoint_id: 'p3', anomalies: [] },
      ])
      .mockResolvedValueOnce(undefined);

    const r = await servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA);

    expect(r.compliancePct).toBe(75);
  });

  it('si los marco TODOS queda completada, aunque cierre a mano', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: RONDA, status: 'en_curso', site_id: RECINTO, expected_checkpoint_ids: ['p1'] },
      ])
      .mockResolvedValueOnce([{ checkpoint_id: 'p1', anomalies: [] }])
      .mockResolvedValueOnce(undefined);

    const r = await servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA);

    expect(r.status).toBe('completada');
    expect(r.compliancePct).toBe(100);
  });

  it('no deja cerrar una ronda ya cerrada', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: RONDA, status: 'completada', site_id: RECINTO, expected_checkpoint_ids: [] },
      ]);

    await expect(
      servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('no deja cerrar la ronda de otro guardia', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);

    await expect(
      servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el motivo queda como novedad de la ronda, no se pierde', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: RONDA, status: 'en_curso', site_id: RECINTO, expected_checkpoint_ids: ['p1', 'p2'] },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA, 'La reja estaba cerrada');

    const evento = query.mock.calls.find((c) => /INSERT INTO field_events/.test(String(c[0])));
    expect(evento).toBeDefined();
    expect(String(evento?.[1]?.[3])).toMatch(/La reja estaba cerrada/);
  });

  it('un motivo en blanco no crea una novedad vacia', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: RONDA, status: 'en_curso', site_id: RECINTO, expected_checkpoint_ids: ['p1'] },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    await servicioConReglas(query).finishPatrolEarly(GUARDIA, RONDA, '   ');

    expect(query.mock.calls.filter((c) => /INSERT INTO field_events/.test(String(c[0])))).toHaveLength(0);
  });
});

describe('pausar y reanudar la ronda', () => {
  const servicio2 = (query: jest.Mock) =>
    new GuardService(
      { manager: { query } } as unknown as TenantContextService,
      vacio({ enqueue: jest.fn() }) as unknown as MailQueueService,
      vacio({ effective: jest.fn() }) as unknown as RulesService,
      vacio({ notify: jest.fn() }) as unknown as EscalationService,
      vacio({ assertPatrolStartAllowed: jest.fn() }) as unknown as GpsPolicyService,
      vacio({ alCerrarRonda: jest.fn() }) as unknown as EnvioInformeService,
    );

  it('deja constancia ANTES de cambiar el estado', async () => {
    /*
     * Si el INSERT fallara despues del UPDATE, la ronda quedaria `pausada` sin
     * fila que diga desde cuando, y el informe no podria calcular el tiempo
     * detenido. El orden importa.
     */
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RONDA, status: 'en_curso' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await servicio2(query).pausePatrol(GUARDIA, RONDA);

    const sqls = query.mock.calls.map((c) => String(c[0]));
    const iInsert = sqls.findIndex((q) => /INSERT INTO patrol_pauses/.test(q));
    const iUpdate = sqls.findIndex((q) => /UPDATE patrols SET status = 'pausada'/.test(q));
    expect(iInsert).toBeGreaterThan(-1);
    expect(iInsert).toBeLessThan(iUpdate);
  });

  it('no deja pausar una ronda que no esta en curso', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: RONDA, status: 'completada' }]);
    await expect(servicio2(query).pausePatrol(GUARDIA, RONDA)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('no deja pausar dos veces', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: RONDA, status: 'pausada' }]);
    await expect(servicio2(query).pausePatrol(GUARDIA, RONDA)).rejects.toThrow(/ya está pausada/i);
  });

  it('no deja pausar la ronda de otro guardia', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);
    await expect(servicio2(query).pausePatrol(GUARDIA, RONDA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('el motivo en blanco se guarda como nulo, no como cadena vacia', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RONDA, status: 'en_curso' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await servicio2(query).pausePatrol(GUARDIA, RONDA, '  ');

    const insert = query.mock.calls.find((c) => /INSERT INTO patrol_pauses/.test(String(c[0])));
    expect(insert?.[1]?.[1]).toBeNull();
  });

  it('reanudar cierra la pausa ABIERTA, no "la ultima"', async () => {
    // Si quedaran dos abiertas, cerrar la mas reciente dejaria la otra abierta
    // para siempre y el tiempo pausado creceria solo.
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: RONDA, status: 'pausada' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const r = await servicio2(query).resumePatrol(GUARDIA, RONDA);

    expect(r.status).toBe('en_curso');
    const cierre = query.mock.calls.find((c) => /UPDATE patrol_pauses/.test(String(c[0])));
    expect(String(cierre?.[0])).toMatch(/resumed_at IS NULL/);
  });

  it('no deja reanudar una que no esta pausada', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: RONDA, status: 'en_curso' }]);
    await expect(servicio2(query).resumePatrol(GUARDIA, RONDA)).rejects.toThrow(/no está pausada/i);
  });
});

describe('una ronda pausada sigue siendo una ronda ABIERTA', () => {
  /*
   * Es el agujero que casi se cuela: las consultas filtraban por
   * ('pendiente','en_curso'), asi que al pausar la ronda desaparecia del home
   * —el guardia creia no tener ninguna— y podia abrir otra encima.
   */
  const fuente = readFileSync(join(__dirname, 'guard.service.ts'), 'utf8');

  it('ninguna consulta cuenta rondas abiertas sin incluir la pausada', () => {
    const sinPausada = fuente.match(/IN \('pendiente', 'en_curso'\)(?! *,)/g) ?? [];
    expect(sinPausada).toEqual([]);
  });

  it('y las que las cuentan, la incluyen', () => {
    const conPausada = fuente.match(/IN \('pendiente', 'en_curso', 'pausada'\)/g) ?? [];
    expect(conPausada.length).toBeGreaterThanOrEqual(5);
  });
});
