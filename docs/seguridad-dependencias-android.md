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
