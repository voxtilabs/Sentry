const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const MARKER = '// SentryCore: serialize discovery and cancellation on the same monitor.';
const CALLBACK = `public void onTagDiscovered(Tag tag) {
                                ${MARKER}
                                synchronized (manager) {
                                    // Reserve Android dispatch without inspecting a tag until the
                                    // guard presses Scan (or explicitly uses NFC on the login page).
                                    if (!isResumed || !isForegroundEnabled || tag == null || techRequest == null) return;
                                    try {
                                        manager.tag = tag;
                                        WritableMap nfcTag;
                                        if (Arrays.asList(tag.getTechList()).contains(Ndef.class.getName())) {
                                            Ndef ndef = Ndef.get(tag);
                                            nfcTag = ndef == null ? tag2React(tag)
                                                : ndef2React(ndef, new NdefMessage[] { ndef.getCachedNdefMessage() });
                                        } else {
                                            nfcTag = tag2React(tag);
                                        }
                                        if (nfcTag != null) {
                                            sendEvent("NfcManagerDiscoverTag", nfcTag);
                                            TagTechnologyRequest pending = techRequest;
                                            if (pending != null && !pending.isConnected()) {
                                                boolean connected = pending.connect(tag);
                                                if (techRequest == pending) {
                                                    pending.invokePendingCallback(connected ? pending.getTechType() : null);
                                                }
                                            }
                                        }
                                    } catch (RuntimeException error) {
                                        // An Android tag handle may expire while discovery is in flight.
                                        // Do not log tag contents, identifiers or raw exception messages.
                                        Log.w(LOG_TAG, "NFC discovery recovered: " + error.getClass().getSimpleName());
                                        TagTechnologyRequest pending = techRequest;
                                        techRequest = null;
                                        if (pending != null) {
                                            pending.close();
                                            try {
                                                pending.invokePendingCallbackWithError("nfc-reader-recovered:" + error.getClass().getSimpleName());
                                            } catch (RuntimeException ignored) {
                                                // React may already have completed or destroyed the callback.
                                            }
                                        }
                                    }
                                }
                            }`;

/** Apply only to the supported library layout; fail a build instead of silently losing protection. */
function patchNfcManagerJava(source) {
  if (source.includes(MARKER)) {
    if (source.includes(CALLBACK)) return source;
    // Update the first audited patch after a local prebuild, without requiring
    // a reinstall of node_modules. Unknown marked variants must fail closed.
    const previous = CALLBACK.replace(
      '                                    // Reserve Android dispatch without inspecting a tag until the\n' +
      '                                    // guard presses Scan (or explicitly uses NFC on the login page).\n' +
      '                                    if (!isResumed || !isForegroundEnabled || tag == null || techRequest == null) return;',
      '                                    if (!isResumed || !isForegroundEnabled || tag == null) return;',
    );
    if (source.includes(previous)) return source.replace(previous, CALLBACK);
    throw new Error('NFC reader safety patch layout changed');
  }
  if (!source.includes('private Boolean isResumed = false;') ||
      !source.includes('private Boolean isForegroundEnabled = false;')) {
    throw new Error('NFC lifecycle fields changed');
  }
  const signature = 'public void onTagDiscovered(Tag tag) {';
  const start = source.indexOf(signature);
  if (start < 0 || source.indexOf(signature, start + 1) !== -1) {
    throw new Error('NFC reader callback layout changed');
  }
  let level = 1;
  let end = start + signature.length;
  while (level && end < source.length) {
    const char = source[end++];
    if (char === '{') level++;
    else if (char === '}') level--;
  }
  if (level) throw new Error('NFC reader callback is incomplete');
  const callback = source.slice(start, end);
  if (!callback.includes('synchronized (this)') || !callback.includes('techRequest.connect(tag)')) {
    throw new Error('NFC reader callback no longer matches the audited version');
  }
  return (source.slice(0, start) + CALLBACK + source.slice(end))
    .replace('private Boolean isForegroundEnabled = false;', 'private volatile Boolean isForegroundEnabled = false;')
    .replace('private Boolean isResumed = false;', 'private volatile Boolean isResumed = false;');
}

/** Cancellation must also cover the JS preflight before a native request exists. */
function patchNfcManagerAndroidJs(source) {
  const marker = '// SentryCore: invalidate requests still awaiting the registration preflight.';
  const request = 'requestTechnology = async (tech, options = {}) => {\n    try {';
  const preflight = 'const sessionAvailable = await this._hasTagEventRegistrationAndroid();';
  const nativeRequest = "return await callNative('requestTechnology', [tech]);";
  const cancel = 'cancelTechnologyRequest = async (options = {}) => {';
  const check = "if (generation !== (this.sentryCancelGeneration || 0)) throw 'cancelled';";
  const cancelGeneration = 'this.sentryCancelGeneration = (this.sentryCancelGeneration || 0) + 1;';
  if (source.includes(marker)) {
    if (source.split(check).length !== 3 ||
        !source.includes(`${preflight}\n      ${check}`) ||
        !source.includes(`${check}\n      ${nativeRequest}`) ||
        !source.includes(`${cancel}\n    ${cancelGeneration}`)) {
      throw new Error('NFC Android JS safety patch layout changed');
    }
    return source;
  }
  for (const shape of [request, preflight, nativeRequest, cancel]) {
    if (source.split(shape).length !== 2) throw new Error('NFC Android JS request layout changed');
  }
  return source
    .replace(request, `${request}\n      ${marker}\n      const generation = this.sentryCancelGeneration || 0;`)
    .replace(preflight, `${preflight}\n      ${check}`)
    .replace(nativeRequest, `${check}\n      ${nativeRequest}`)
    .replace(cancel, `${cancel}\n    ${cancelGeneration}`);
}

module.exports = function withNfcReaderSafety(config) {
  return withDangerousMod(config, ['android', async result => {
    const root = path.dirname(require.resolve('react-native-nfc-manager/package.json'));
    for (const [relative, transform] of [
      ['android/src/main/java/community/revteltech/nfc/NfcManager.java', patchNfcManagerJava],
      ['src/NfcManagerAndroid.js', patchNfcManagerAndroidJs],
    ]) {
      const file = path.join(root, relative);
      const original = await fs.readFile(file, 'utf8');
      const patched = transform(original);
      if (patched !== original) await fs.writeFile(file, patched);
    }
    return result;
  }]);
};
module.exports.patchNfcManagerJava = patchNfcManagerJava;
module.exports.patchNfcManagerAndroidJs = patchNfcManagerAndroidJs;
