const { AndroidConfig } = require('expo/config-plugins');

const OPTIONAL_FEATURES = [
  'android.hardware.nfc',
  'android.hardware.camera',
  'android.hardware.camera.any',
  'android.hardware.camera.autofocus',
  'android.hardware.location.gps',
  'android.hardware.screen.portrait',
  'android.hardware.wifi',
];

/** Check the merged artifact, including declarations contributed by libraries. */
function verifyOptionalHardware(manifest) {
  const features = manifest['uses-feature'] ?? [];
  for (const name of OPTIONAL_FEATURES) {
    const entries = features.filter(entry => entry.$?.['android:name'] === name);
    if (entries.length !== 1 || entries[0].$['android:required'] !== 'false') {
      throw new Error(`Hardware must be explicitly optional in the merged manifest: ${name}`);
    }
  }
  return { optionalHardwareVerified: OPTIONAL_FEATURES.length };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Pass the merged AndroidManifest.xml path');
  AndroidConfig.Manifest.readAndroidManifestAsync(file)
    .then(result => console.log(JSON.stringify(verifyOptionalHardware(result.manifest))))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifyOptionalHardware };
