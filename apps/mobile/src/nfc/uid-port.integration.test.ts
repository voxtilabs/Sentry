import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { crearReservaLector } from './reserva-lector';
const requireLocal=createRequire(import.meta.url);
function adapter(stop:()=>Promise<void>=async()=>{}) {
 const calls:{flags:number[];techs:unknown[];reports:Error[];unregistered:number}={flags:[],techs:[],reports:[],unregistered:0};
 const manager={start:async()=>{},isSupported:async()=>true,isEnabled:async()=>true,registerTagEvent:async(o:{readerModeFlags:number})=>{calls.flags.push(o.readerModeFlags)},requestTechnology:async(t:unknown,o:{readerModeFlags:number})=>{calls.techs.push(t);calls.flags.push(o.readerModeFlags)},getTag:async()=>({id:'04aabbcc'}),cancelTechnologyRequest:async()=>{},unregisterTagEvent:async()=>{calls.unregistered++}};
 class NativeError extends Error {}
 const nfc={__esModule:true,default:manager,NfcAdapter:{FLAG_READER_NFC_A:1,FLAG_READER_NFC_B:2,FLAG_READER_NFC_F:4,FLAG_READER_NFC_V:8,FLAG_READER_SKIP_NDEF_CHECK:128},NfcTech:{NfcA:'NfcA',NfcB:'NfcB',NfcF:'NfcF',NfcV:'NfcV',MifareUltralight:'MifareUltralight'},NfcError:{RadioDisabled:class extends NativeError{},UserCancel:class extends NativeError{},Timeout:class extends NativeError{},TagConnectionLost:class extends NativeError{},TagNotConnected:class extends NativeError{},SystemBusy:class extends NativeError{}}};
 const code=ts.transpileModule(readFileSync(requireLocal.resolve('./native-port.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports:Record<string,unknown>={};const requireMock=(id:string)=>{
  if(id==='react-native-nfc-manager')return nfc;if(id==='react-native')return{Vibration:{vibrate:()=>{}}};
  if(id.includes('reserva-lector'))return{reservarLector:crearReservaLector()};if(id.includes('login-nfc-listener'))return{detenerEscuchaNfcLogin:stop};
  if(id.includes('crash-reporter'))return{reportarCaida:async(e:Error)=>{calls.reports.push(e)}};if(id.includes('device-signature'))return{firmarEscaneo:async()=>({})};return{posicionDelEscaneo:async()=>undefined};
 };
 new Function('require','exports',code)(requireMock,exports);
 const port=exports.puertoNfcAndroid as {iniciar:()=>Promise<void>;esperarEtiqueta:()=>Promise<{id:string}>;cancelar:()=>Promise<void>;clasificarError:(e:unknown)=>string};
 return{port,calls};
}
test('actual Android adapter reads UID using physical technologies and skips NDEF in every registration/request',async()=>{
 const {port,calls}=adapter();await port.iniciar();assert.deepEqual(await port.esperarEtiqueta(),{id:'04aabbcc'});await port.cancelar();
 assert(calls.flags.length>=2);for(const flags of calls.flags)assert.equal(flags&0x8f,0x8f);
 assert.deepEqual(calls.techs,[['NfcA','NfcB','NfcF','NfcV','MifareUltralight']]);assert.equal(calls.unregistered,0);
});
test('actual point adapter waits until login cancellation has finished before starting its request',async()=>{
 let release!:()=>void;const done=new Promise<void>(r=>{release=r});const {port,calls}=adapter(()=>done);
 const read=port.esperarEtiqueta();await new Promise(r=>setImmediate(r));assert.equal(calls.techs.length,0);release();await read;assert.equal(calls.techs.length,1);
});
test('a recovered native class is reported without tag data and becomes a retryable connection failure',()=>{
 const {port,calls}=adapter();assert.equal(port.clasificarError(new Error('nfc-reader-recovered:SecurityException')),'conexion-perdida');
 assert.equal(calls.reports[0]?.message,'NfcReaderRecovered:SecurityException');assert.equal(port.clasificarError(new Error('nfc-reader-recovered:UID=04AABBCC')),'desconocido');assert.equal(calls.reports.length,1);
});
