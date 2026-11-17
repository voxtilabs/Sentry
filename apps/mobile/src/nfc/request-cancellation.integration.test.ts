import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { crearEscuchaLogin } from './login-reader';

const requireLocal = createRequire(import.meta.url);
const { patchNfcManagerAndroidJs } = requireLocal('../../plugins/with-nfc-reader-safety.js') as {
  patchNfcManagerAndroidJs: (source: string) => string;
};
const upstream = JSON.parse(readFileSync(new URL('./fixtures/reader-upstream-3.17.2.json', import.meta.url), 'utf8')) as {
  androidJsSource: string;
};
const installed = readFileSync(requireLocal.resolve('react-native-nfc-manager/src/NfcManagerAndroid.js'), 'utf8');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function load(source: string, requireMock: (id: string) => unknown) {
  const code = ts.transpileModule(source, {
    compilerOptions: { allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)(requireMock, exports);
  return exports;
}
const errors = load(readFileSync(requireLocal.resolve('react-native-nfc-manager/src/NfcError.js'), 'utf8'),
  () => ({ Platform: { OS: 'android' } }));
function manager(source: string) {
  const registration = deferred<boolean>();
  let requests = 0;
  class Base {
    async registerTagEvent() {}
    async unregisterTagEvent() {}
  }
  const native = async (name: string) => {
    if (name === 'hasTagEventRegistration') return registration.promise;
    if (name === 'requestTechnology') { requests++; return 'NfcA'; }
    return undefined;
  };
  const exported = load(source, id => {
    if (id === './NfcManager') return { NfcManagerBase: Base };
    if (id === './NativeNfcManager') return { callNative: native };
    if (id === './NfcError') return errors;
    return {};
  });
  const Constructor = exported.NfcManagerAndroid as new () => {
    requestTechnology(tech: string): Promise<void>;
    cancelTechnologyRequest(): Promise<void>;
  };
  return { manager: new Constructor(), registration, requests: () => requests };
}

test('real upstream JS creates an orphaned native request when cancelled during the preflight', async () => {
  const subject = manager(upstream.androidJsSource);
  const read = subject.manager.requestTechnology('NfcA');
  await tick();
  await subject.manager.cancelTechnologyRequest();
  subject.registration.resolve(true);
  await read;
  assert.equal(subject.requests(), 1, 'baseline continues after the cancellation');
});

test('patched real JS aborts a preflight cancelled before the native request exists', async () => {
  const subject = manager(patchNfcManagerAndroidJs(installed));
  const read = subject.manager.requestTechnology('NfcA');
  const result = read.catch(error => error);
  await tick();
  await subject.manager.cancelTechnologyRequest();
  subject.registration.resolve(true);
  assert((await result) instanceof (errors.UserCancel as new () => Error));
  assert.equal(subject.requests(), 0);
  await subject.manager.requestTechnology('NfcA');
  assert.equal(subject.requests(), 1, 'a later intentional point scan still works');
});

test('leaving login during the real JS preflight finishes cleanup before the next point scan', async () => {
  const subject = manager(patchNfcManagerAndroidJs(installed));
  const login = crearEscuchaLogin({
    start: async () => {}, supported: async () => true, enabled: async () => true,
    reserve: async () => {}, request: () => subject.manager.requestTechnology('NfcA'),
    read: async () => ({ id: '04aabbcc' }), cancel: () => subject.manager.cancelTechnologyRequest(),
    confirm: () => assert.fail('cancelled login must not confirm a tag'),
  });
  const running = login.iniciar(() => assert.fail('late login tag'));
  await tick();
  const stopped = login.detener();
  subject.registration.resolve(true);
  await stopped;
  await running;
  assert.equal(subject.requests(), 0);
  await subject.manager.requestTechnology('NfcA');
  assert.equal(subject.requests(), 1);
});

test('JS patch is reproducible, idempotent and refuses a different upstream layout', () => {
  const fresh = patchNfcManagerAndroidJs(upstream.androidJsSource);
  assert.equal(patchNfcManagerAndroidJs(fresh), fresh);
  assert.equal(patchNfcManagerAndroidJs(installed), fresh);
  assert.throws(() => patchNfcManagerAndroidJs('other library version'));
  assert.throws(() => patchNfcManagerAndroidJs(fresh.replace('this.sentryCancelGeneration =', 'this.otherGeneration =')));
});
