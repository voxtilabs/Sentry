import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import test from 'node:test';

test('un GPS sin fix libera el lector y desuscribe incluso si Android entrega tarde la suscripción', async () => {
  const loader=Module as unknown as {_load:(name:string,...args:unknown[])=>unknown};
  const original=loader._load;
  let finishWatch!:()=>void;
  let removed=0;
  loader._load=(name,...args)=>name==='expo-location'?{
    Accuracy:{BestForNavigation:6},
    getForegroundPermissionsAsync:async()=>({status:'granted'}),
    getLastKnownPositionAsync:async()=>null,
    getCurrentPositionAsync:()=>new Promise(()=>{}),
    watchPositionAsync:()=>new Promise(resolve=>{
      finishWatch=()=>resolve({remove:()=>{removed++;}});
    }),
  }:original(name,...args);
  let read:typeof import('./posicion').posicionDelEscaneo;
  try { read=createRequire(__filename)('./posicion').posicionDelEscaneo; }
  finally { loader._load=original; }
  const result=await Promise.race([read(),new Promise<string>(resolve=>{
    const timer=setTimeout(()=>resolve('atascado'),4_000);timer.unref();
  })]);
  assert.equal(result,undefined);
  finishWatch();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(removed,1);
});
