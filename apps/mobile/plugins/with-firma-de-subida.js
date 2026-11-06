const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Firma el `release` con la llave de SUBIDA de Google Play cuando esta
 * disponible en el entorno.
 *
 * POR QUE UN PLUGIN Y NO EDITAR android/app/build.gradle: `android/` esta en
 * .gitignore y el CI lo regenera con `expo prebuild --clean` en cada corrida.
 * Editar el archivo generado "funciona" en la maquina de uno y desaparece en
 * CI — que es exactamente lo que paso: el primer AAB salio firmado con la
 * llave de DEPURACION y lo caz la verificacion de huellas del workflow, no
 * una revision humana.
 *
 * COMO DECIDE CON QUE FIRMAR: si existe ANDROID_KEYSTORE_PATH en el entorno de
 * Gradle, usa esa llave; si no, cae a la de depuracion. Eso mantiene vivo el
 * APK de prueba, que se compila sin tocar ningun secreto y se instala a mano en
 * los telefonos del equipo. Son dos llaves distintas a proposito: una publica,
 * la otra no.
 *
 * Las credenciales NUNCA se escriben en el archivo: se leen del entorno en
 * tiempo de compilacion. Un keystore o una contraseña dentro de build.gradle
 * termina, tarde o temprano, dentro de un artefacto.
 */
const CONFIG_DE_FIRMA = `
        subida {
            def rutaKeystore = System.getenv('ANDROID_KEYSTORE_PATH')
            if (rutaKeystore) {
                storeFile file(rutaKeystore)
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }
`;

const FIRMA_DEL_RELEASE = `signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.subida : signingConfigs.debug`;

module.exports = function withFirmaDeSubida(config) {
  return withAppBuildGradle(config, (resultado) => {
    let gradle = resultado.modResults.contents;

    if (!gradle.includes('signingConfigs {')) {
      throw new Error('with-firma-de-subida: no se encontro el bloque signingConfigs');
    }
    if (gradle.includes('subida {')) return resultado;

    // El bloque nuevo entra JUSTO despues de abrir signingConfigs, al lado del
    // de depuracion que ya escribe el template.
    gradle = gradle.replace('signingConfigs {', `signingConfigs {${CONFIG_DE_FIRMA}`);

    /*
     * El template de Expo deja el release firmado con la llave de depuracion y
     * un comentario que avisa de que hay que cambiarlo. Se reemplaza ESA linea
     * y solo esa: el `debug { signingConfig signingConfigs.debug }` de arriba
     * tiene que quedar intacto.
     */
    const dentroDelRelease = /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!dentroDelRelease.test(gradle)) {
      throw new Error('with-firma-de-subida: no se encontro la firma del buildType release');
    }
    gradle = gradle.replace(dentroDelRelease, `$1${FIRMA_DEL_RELEASE}`);

    resultado.modResults.contents = gradle;
    return resultado;
  });
};
