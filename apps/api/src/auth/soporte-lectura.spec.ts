import { PERMISOS_DE_LECTURA_DE_SOPORTE, elSoporteLoPuedeLeer } from './soporte-lectura';
import { ROLE_PERMISSIONS } from '@sentrycore/shared';

const base = {
  role: 'SUPERADMIN' as const,
  metodo: 'GET',
  tenantDeLaVentana: 'tenant-1',
  permisosExigidos: ['reports:read'] as const,
};

describe('lo que el soporte puede leer durante una ventana auditada (#109)', () => {
  it('con ventana vigente, un GET de informes pasa', () => {
    expect(elSoporteLoPuedeLeer({ ...base })).toBe(true);
  });

  it('sin ventana no pasa nada: es la unica llave', () => {
    expect(elSoporteLoPuedeLeer({ ...base, tenantDeLaVentana: null })).toBe(false);
  });

  it('NUNCA escribe, aunque el permiso este en la lista', () => {
    // La garantia no depende de que la lista siga siendo solo de lectura: un
    // POST no entra ni con la ventana abierta.
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(elSoporteLoPuedeLeer({ ...base, metodo })).toBe(false);
    }
  });

  it('solo el SUPERADMIN: un ADMIN de otra empresa no se cuela por aca', () => {
    for (const role of ['ADMIN', 'SUPERVISOR', 'GUARDIA'] as const) {
      expect(elSoporteLoPuedeLeer({ ...base, role })).toBe(false);
    }
  });

  it('un permiso fuera de la lista no se concede aunque sea de lectura', () => {
    // Los datos de personas quedan afuera a proposito: diagnosticar una ronda
    // no necesita saber quien es el guardia.
    expect(
      elSoporteLoPuedeLeer({ ...base, permisosExigidos: ['tenant:users:manage'] }),
    ).toBe(false);
    expect(
      elSoporteLoPuedeLeer({ ...base, permisosExigidos: ['reports:read', 'tenant:users:manage'] }),
    ).toBe(false);
  });

  it('un endpoint sin permisos declarados no se abre solo', () => {
    expect(elSoporteLoPuedeLeer({ ...base, permisosExigidos: [] })).toBe(false);
  });

  it('todo lo que concede lo tiene el ADMIN de esa empresa: no inventa poderes', () => {
    /*
     * El soporte no puede ver MAS que el dueño de los datos. Si algun dia se
     * agrega a la lista un permiso que el ADMIN no tiene, esto falla y obliga a
     * mirarlo de nuevo.
     */
    const delAdmin = ROLE_PERMISSIONS.ADMIN as readonly string[];
    for (const permiso of PERMISOS_DE_LECTURA_DE_SOPORTE) {
      expect(delAdmin).toContain(permiso);
    }
  });

  it('la lista es corta y toda de lectura', () => {
    expect(PERMISOS_DE_LECTURA_DE_SOPORTE.length).toBeLessThanOrEqual(5);
    for (const permiso of PERMISOS_DE_LECTURA_DE_SOPORTE) {
      expect(permiso).toMatch(/:read$/);
    }
  });
});
