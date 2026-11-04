const { withAppBuildGradle } = require('expo/config-plugins');

/** Expo regenera Gradle: conservar el ajuste en el plugin, no en android/. */
module.exports = function withR8Release(config) {
  return withAppBuildGradle(config, (result) => {
    const original = result.modResults.contents;
    const optimized = original.replace(/proguard-android\.txt/g, 'proguard-android-optimize.txt');
    if (!optimized.includes('proguard-android-optimize.txt')) {
      throw new Error('with-r8-release: no se encontró la configuración estándar de R8');
    }
    result.modResults.contents = optimized;
    return result;
  });
};
