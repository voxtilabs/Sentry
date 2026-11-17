import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const requireLocal = createRequire(import.meta.url);
interface Feature { $: Record<string,string>; }
interface Manifest { $:Record<string,string>; 'uses-feature'?:Feature[]; application:Array<{activity:Array<{$:Record<string,string>}>}>; }
const plugin=requireLocal('../../plugins/with-android-manifest-extras.js') as (config:Record<string,unknown>)=>{mods:{android:{manifest:(config:Record<string,unknown>)=>Promise<{modResults:{manifest:Manifest}}>}}};
const {verifyOptionalHardware}=requireLocal('../../scripts/verify-hardware.cjs') as {verifyOptionalHardware:(manifest:Manifest)=>unknown};
async function transform(features:Feature[]=[]) {
 const config=plugin({name:'Hardware test',slug:'hardware-test'});
 const result=await config.mods.android.manifest({...config,modResults:{manifest:{$:{},'uses-feature':features,application:[{activity:[{$:{'android:name':'.MainActivity'}}]}]}},modRequest:{platform:'android',modName:'manifest',projectRoot:process.cwd()}});
 return result.modResults.manifest;
}
test('prebuild explicitly opts out of portrait and Wi-Fi installation filters',async()=>{
 const manifest=await transform();assert.doesNotThrow(()=>verifyOptionalHardware(manifest));
});
test('an existing mandatory dependency declaration is overridden without duplicate features',async()=>{
 const manifest=await transform(['android.hardware.screen.portrait','android.hardware.wifi'].map(name=>({$:{'android:name':name,'android:required':'true'}})));
 assert.doesNotThrow(()=>verifyOptionalHardware(manifest));
 for(const feature of manifest['uses-feature']??[])assert(feature.$['tools:replace']?.split(',').includes('android:required'));
});
test('the merged-manifest guard rejects both missing and required hardware declarations',async()=>{
 const manifest=await transform();
 for(const name of ['android.hardware.screen.portrait','android.hardware.wifi']) {
  const changed=structuredClone(manifest),feature=changed['uses-feature']?.find(f=>f.$['android:name']===name);assert(feature);
  feature.$['android:required']='true';assert.throws(()=>verifyOptionalHardware(changed));
  changed['uses-feature']=changed['uses-feature']?.filter(f=>f!==feature);assert.throws(()=>verifyOptionalHardware(changed));
 }
});
