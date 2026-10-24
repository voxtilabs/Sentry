import type { Permission, Role } from '@sentrycore/shared';

/**
 * Lo que puede LEER el soporte durante una ventana auditada (#109).
 *
 * El mecanismo de acceso de soporte abria la puerta de la RLS y se quedaba a
 * mitad de camino: el SUPERADMIN no tiene ningun permiso de empresa —y esta
 * bien que no lo tenga— asi que todos los endpoints del tenant seguian
 * respondiendo 403. Una ventana que no deja mirar nada no sirve para
 * diagnosticar el problema de un cliente, que es para lo unico que existe.
 *
 * Esta lista es la respuesta, y es deliberadamente corta:
 *
 * - Son CUATRO permisos y los cuatro son de lectura. Nada que cree, modifique
 *   o borre datos del cliente: para eso esta su propio ADMIN.
 * - Solo se conceden en peticiones GET. No es redundante con lo anterior: deja
 *   la garantia en algo que se puede verificar de un vistazo en vez de depender
 *   de que ningun POST futuro se cuele en la lista.
 * - Exigen una ventana VIGENTE, con motivo escrito, que vence sola y que el
 *   ADMIN de esa empresa puede leer en su propio registro.
 *
 * Lo que NO se concede, aunque sea lectura: los datos de personas (usuarios,
 * sesiones, consentimiento). Diagnosticar una ronda no necesita saber quien es
 * el guardia.
 */
export const PERMISOS_DE_LECTURA_DE_SOPORTE: readonly Permission[] = [
  'tenant:dashboard:read',
  'tenant:stats:read',
  'tenant:audit:read',
  'reports:read',
];

/**
 * Si esta peticion puede resolverse con la ventana de soporte.
 *
 * Devuelve false ante la menor duda: es una funcion de autorizacion y el caso
 * ambiguo es el que hay que negar.
 */
export function elSoporteLoPuedeLeer(entrada: {
  role: Role;
  metodo: string;
  tenantDeLaVentana: string | null;
  permisosExigidos: readonly Permission[];
}): boolean {
  if (entrada.role !== 'SUPERADMIN') return false;
  if (entrada.metodo.toUpperCase() !== 'GET') return false;
  if (!entrada.tenantDeLaVentana) return false;
  if (entrada.permisosExigidos.length === 0) return false;
  return entrada.permisosExigidos.every((permiso) =>
    PERMISOS_DE_LECTURA_DE_SOPORTE.includes(permiso),
  );
}
