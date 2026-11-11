import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { crearReservaLector } from './reserva-lector';

// Ejecutar la implementación Android instalada, sustituyendo solo el puente
// físico. Así se detecta si una actualización de la librería libera la reserva.
function managerAndroid() {
  let registrada=false, liberaciones=0, solicitudes=0;
  class Base {
    async registerTagEvent() { registrada=true; }
    async unregisterTagEvent() { registrada=false; liberaciones++; }
  }
  const requireLocal=createRequire(import.meta.url);
  const file=requireLocal.resolve('react-native-nfc-manager/src/NfcManagerAndroid.js');
  const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{allowJs:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string, unknown>={};
  const native=async(name:string)=>{if(name==='hasTagEventRegistration')return registrada;if(name==='requestTechnology')solicitudes++;};
  const requireMock=(name:string)=>name==='./NfcManager'?{NfcManagerBase:Base}:name==='./NativeNfcManager'?{callNative:native}:name==='./NfcError'?{handleNativeException:(p:Promise<unknown>)=>p,buildNfcExceptionAndroid:(e:unknown)=>e}:{};
  new Function('require','exports',source)(requireMock,exports);
  const Constructor=exports.NfcManagerAndroid as new()=> {registerTagEvent():Promise<void>;requestTechnology(tech:string):Promise<void>;cancelTechnologyRequest(options:{delayMsAndroid:number}):Promise<void>};
  return {manager:new Constructor(),estado:()=>({registrada,liberaciones,solicitudes})};
}

test('cancelar dos escaneos reales de la librería no libera el lector reservado',async()=>{
  const {manager,estado}=managerAndroid(),reservar=crearReservaLector();
  await reservar(()=>manager.registerTagEvent());
  assert.equal(estado().solicitudes,0,'la reserva no escanea puntos por su cuenta');
  for(let i=0;i<2;i++){
    await manager.requestTechnology('NfcA');
    await manager.cancelTechnologyRequest({delayMsAndroid:0});
    assert.equal(estado().registrada,true);
    assert.equal(estado().liberaciones,0);
  }
  assert.equal(estado().solicitudes,2);
});

test('el mismo cancelador sí liberaría un lector creado únicamente para el escaneo',async()=>{
  const {manager,estado}=managerAndroid();
  await manager.requestTechnology('NfcA');
  await manager.cancelTechnologyRequest({delayMsAndroid:0});
  assert.equal(estado().registrada,false);
  assert.equal(estado().liberaciones,1);
});
