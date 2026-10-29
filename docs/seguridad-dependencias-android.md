# Revisión de dependencias Android — 23-10-2026

El CI del shell Android compiló tipos, pasó las pruebas del puente y validó la
configuración de producción, pero falló en la auditoría por diez paquetes nuevos.
Se revisó `npm audit --omit=dev --json` y el árbol real; no era un error de Gradle
ni del AAB. El control continúa rechazando paquetes no revisados.

Se actualizaron únicamente nueve dependencias transitivas, respetando sus rangos
y manteniendo Expo 57.0.9, React Native 0.86.2 y las versiones directas:

| Paquete | Antes | Después |
|---|---|---|
| @expo/metro-file-map | 57.0.1 | 57.0.4 |
| @xmldom/xmldom | 0.8.13 / 0.9.10 | 0.8.15 / 0.9.12 |
| brace-expansion | 5.0.9 | 5.0.12 |
| compression | 1.8.1 | 1.8.2 |
| js-yaml | 4.3.0 | 4.3.2 |
| nanoid | 3.3.16 | 3.3.20 |
| shell-quote | 1.10.0 | 1.12.0 |
| source-map-js | 1.2.1 | 1.2.2 |

Se corrigió el aviso crítico de shell-quote y se quitaron de las excepciones
xmldom, js-yaml y nanoid, ya resueltos. No se utilizó `npm audit fix --force`, que
proponía degradar Expo a SDK 44.

Permanecen cinco paquetes nuevos revisados sin parche compatible, además de los
avisos de Expo/RN que ya estaban documentados:

- **braces**, y sus dependientes **micromatch** y **metro-file-map**:
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  declara que no hay versión parcheada. El riesgo es agotamiento de pila al
  procesar patrones anidados en el bundler. Las entradas de visitantes no se
  convierten en patrones; el despliegue sirve bundles estáticos, sin exponer Metro.
- **node-forge** y **@expo/code-signing-certificates**:
  [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
  declara que no hay versión parcheada hasta 1.4.0 inclusive. Los arrastra Expo
  CLI para certificados; no son el verificador de JWT, TLS ni credenciales de
  SentryCore. No usar certificados o proyectos no confiables con ese tooling.

Esto es una excepción documentada del control, no una corrección de esos dos
avisos ni una afirmación de cero vulnerabilidades. Revisar y retirar las
excepciones cuando los mantenedores publiquen versiones compatibles.

## Revisión adicional del 24-10-2026

La auditoría empezó a señalar también **zod 3.25.76**, dependencia de Expo CLI
(`^3.25.76`), por [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
actualizado el 23 de octubre. El aviso de agotamiento de memoria con colecciones
grandes se corrige en **4.6.6**, fuera del rango de Expo 57. Una actualización
dirigida no encontró parche dentro de Zod 3; no se fuerza una versión mayor.

Se documenta la excepción para el CLI de compilación: el código móvil no importa
Zod para los datos de las visitas; el CLI valida la configuración local del
proyecto. Esto no corrige el defecto de la biblioteca ni exime a otros servicios
que acepten colecciones no confiables. Retirar esta excepción cuando Expo admita
la versión corregida o exista un backport compatible. La auditoría conserva su
rechazo de paquetes nuevos no revisados.

## Revisión adicional del 29-10-2026

El aviso [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
revisado el 27 de octubre, señala contaminación del prototipo del objeto devuelto
por **deepmerge 4.3.1**. El mantenedor no ha publicado una versión corregida y
4.3.1 sigue siendo la última versión del registro. La actualización dirigida no
modificó el lockfile; no se degrada Expo a SDK 51 ni se fuerza una dependencia.

La cadena real es Expo → `@expo/config` → deepmerge; `@expo/prebuild-config` y
`@expo/local-build-cache-provider` aparecen también por esa dependencia. Se
documentan los cuatro paquetes en la excepción existente. En este proyecto la
entrada mezclada es la configuración local de compilación, mantenida en Git:
el flujo de fotos y respuestas no entrega objetos del guardia a esa biblioteca.
Esto acepta un riesgo acotado del tooling; **no corrige la biblioteca**. No usar
configuraciones de proyectos no confiables y retirar la excepción al publicarse
un parche compatible. El control sigue fallando ante paquetes nuevos no revisados.
