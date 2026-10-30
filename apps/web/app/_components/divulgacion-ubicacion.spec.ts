import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * El rechazo de Google Play del 02-10-2026 (Inadequate Prominent Disclosure).
 *
 * El revisor entro con la cuenta de demostracion —que ya tenia el
 * consentimiento aceptado— y lo primero que vio fue el dialogo de Android
 * pidiendo ubicacion, sin nada delante. El codigo lo hacia a proposito: daba
 * por buena la divulgacion de semanas atras.
 *
 * Estas pruebas leen el fuente porque lo que hay que fijar no es como se ve la
 * pantalla, sino DOS INVARIANTES que un refactor puede romper sin que nadie se
 * entere hasta el proximo rechazo, que tarda dias:
 *
 *   1. El texto dice lo que Play exige que diga.
 *   2. No queda ningun camino al dialogo del sistema que no pase por el texto.
 */
const componente = readFileSync(join(__dirname, 'divulgacion-ubicacion.tsx'), 'utf8');
const puente = readFileSync(join(__dirname, 'use-guard-bridge.ts'), 'utf8');

describe('divulgación destacada de ubicación (rechazo de Play 02-10-2026)', () => {
  it('nombra el dato: dice "ubicación", no "datos" a secas', () => {
    expect(componente).toMatch(/recopila datos de ubicación/i);
  });

  it('dice que se recoge con la app cerrada — la frase que faltaba', () => {
    /*
     * Es textual de la guia de Play y es la que mas rechazos provoca. Sin ella
     * el revisor no tiene como saber que el permiso es de segundo plano.
     */
    expect(componente).toMatch(/incluso cuando la aplicación está cerrada o no la estás usando/i);
  });

  it('dice para qué se usa', () => {
    expect(componente).toMatch(/constancia de que la ronda se hizo en terreno/i);
  });

  it('exige una acción afirmativa y ofrece salir sin conceder', () => {
    expect(componente).toMatch(/Continuar/);
    expect(componente).toMatch(/Ahora no/);
  });

  it('no se puede despachar tocando fuera: no hay cierre por el fondo', () => {
    // Un aviso que se va con un toque al costado no es consentimiento previo.
    expect(componente).not.toMatch(/onClick=\{onPosponer\}[\s\S]{0,80}divulgacion-fondo/);
    expect(componente).toMatch(/divulgacion-fondo/);
  });
});

describe('ningún camino abre el diálogo del sistema sin el texto delante', () => {
  it('el puente ya NO pide el permiso de ubicación al ingresar', () => {
    /*
     * Esto es lo que rechazaron. El puente solo puede LEVANTAR la bandera; el
     * `pedirPermiso` de ubicacion vive en el continuar de la divulgacion.
     */
    const bloqueIngreso = puente.slice(0, puente.indexOf('continuarTrasDivulgacion'));
    expect(bloqueIngreso).not.toMatch(/pedirPermiso\('ubicacion'/);
  });

  it('la bandera existe y la baja quien responde', () => {
    expect(puente).toMatch(/setDivulgacionPendiente\(true\)/);
    expect(puente).toMatch(/setDivulgacionPendiente\(false\)/);
  });

  it('el único pedido de ubicación al ingresar está dentro del continuar', () => {
    const desdeContinuar = puente.slice(puente.indexOf('continuarTrasDivulgacion'));
    expect(desdeContinuar).toMatch(/pedirPermiso\('ubicacion', true\)/);
  });
});
