# Portafolio y asignaciones de supervisión (#473)

El supervisor dispone de «Todos mis recintos», agrupados por empresa, con acceso
a puntos/etiquetas, seguimiento en vivo e informes del recinto elegido. El
selector de empresa también se muestra al administrador. Cambiar de empresa
crea la sesión con el rol de la membresía real y revoca únicamente la familia
del navegador que lo pidió; no afecta otras personas ni dispositivos. Las
pestañas administrativas del mismo navegador recargan su contexto al cambiar.

Administradores propietarios y superadministradores tienen «Accesos de
supervisión»: supervisor existente, selección de recintos por empresa y guardado
explícito. Un propietario solo consulta y asigna empresas donde es ADMIN; un
superadministrador conserva el alcance de plataforma. No se crean cuentas ni
se modifican contraseñas desde esta pantalla. Retirar todas las asignaciones
conserva la membresía y el historial, pero deja los recintos inaccesibles.

## Seguridad

Las tres funciones PostgreSQL usan el actor de la sesión validada, search_path
fijo y permisos revocados a PUBLIC. El servicio establece contexto con
set_config(..., true) dentro de una transacción. Las funciones comprueban usuario
activo, rol real, empresa activa y pertenencia de cada recinto antes de escribir.
Se registra el actor y la cantidad de recintos en auditoría; no nombres en logs.
No se modifica ni desactiva RLS en tablas existentes.

## Comprobaciones

- 277 pruebas API: matriz de autorización, guardias de migraciones y seis pruebas
  de integración con PostgreSQL real usando SET LOCAL ROLE sentrycore_app sin
  BYPASSRLS y Redis. Incluyen aislamiento, rechazos de empresas/recintos ajenos,
  roles no autorizados, auditoría del superadmin y cambio de sesión sin cerrar
  el segundo navegador. Los fixtures PostgreSQL se revierten; las claves Redis
  usan usuarios aleatorios, sin FLUSHDB ni cambios a personas reales.
- 12 pruebas de navegación web: entradas alcanzables por cada rol.
- Chromium local en 1440×1000 y 390×844: cuatro recintos de tres empresas,
  navegación cruzada a informes con siteId correcto y guardado simultáneo de
  asignaciones de varias empresas para ADMIN y SUPERADMIN. Seis verificaciones,
  sin errores de página ni desbordamiento horizontal. API interceptada con
  fixtures de prueba, sin enviar correo o modificar producción.
- Typecheck y lint del monorepo aprobados. Build de shared/API/web verificado
  antes de publicar; móvil tiene verificación independiente en nfc-0.3.4.md.

Para repetir la integración, proporcionar DATABASE_TEST_URL (rol migrador),
DATABASE_APP_TEST_URL (rol sin bypass) y REDIS_TEST_URL de pruebas antes de:

```sh
npm test -w @sentrycore/api -- --runInBand staff-access.integration authorization-matrix migrations.spec
npm test -w @sentrycore/web -- --runInBand panel-navigation
npm run typecheck
npm run lint
npm run build
```

La interfaz del guardia y sus consentimientos no se alteran en esta entrega.

## Despliegue

Publicado en staging/servidor mediante PR #475. Trece verificaciones HTTP
contra la API desplegada confirmaron tres empresas y cuatro recintos para
las cuentas autorizadas, cambio de sesión con cookies HttpOnly/Secure,
conservación de la segunda sesión y denegación a anónimos/guardias. Las
sesiones técnicas se revocaron individualmente al terminar; sin envíos de
correo ni escrituras de datos de rondas. PostgreSQL y Redis conservaron
identificador y hora de inicio de sus contenedores; una ronda activa
permaneció activa durante la actualización de API/web.
