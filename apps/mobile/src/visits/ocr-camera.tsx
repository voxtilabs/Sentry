import { Camera, CameraView } from 'expo-camera';
import { useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';
import ocr from '../../modules/sentry-ocr';
import type { ResultadoOcrPayload } from '../bridge/protocol';
import { extraerIdentidad, extraerPatentes } from './ocr-parser';

type Kind = 'identity' | 'plate';
type State = { active:false } | { active:true; kind:Kind; request:number };

export function crearCamaraOcr() {
  let state: State = {active:false};
  let serial = 0;
  let accept: ((result:ResultadoOcrPayload)=>void) | undefined;
  let reject: ((error:Error)=>void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<()=>void>();
  const publish = (next:State) => { state=next; listeners.forEach(fn=>fn()); };
  const stop = () => { if(timeout) clearTimeout(timeout); accept=undefined; reject=undefined; publish({active:false}); };
  const cancel = () => { serial++; reject?.(new Error('Lectura cancelada')); stop(); };
  return {
    subscribe:(fn:()=>void) => {listeners.add(fn);return()=>{listeners.delete(fn);};},
    snapshot:()=>state,
    cancel,
    scan:async(kind:Kind):Promise<ResultadoOcrPayload> => {
      cancel();
      const id=++serial;
      const permission=await Camera.requestCameraPermissionsAsync();
      if(permission.status!=='granted') throw new Error('Permite el uso de la cámara en los ajustes del teléfono');
      if(id!==serial) throw new Error('Lectura cancelada');
      return new Promise((resolve,rejecter)=>{
        accept=resolve;reject=rejecter;publish({active:true,kind,request:id});
        timeout=setTimeout(cancel,120_000);
      });
    },
    resolve:(request:number,result:ResultadoOcrPayload)=>{
      if(state.active && state.request===request) {accept?.(result);stop();}
    },
  };
}

export function VistaCamaraOcr({camera}:{camera:ReturnType<typeof crearCamaraOcr>}) {
  const state=useSyncExternalStore(camera.subscribe,camera.snapshot,camera.snapshot);
  const view=useRef<CameraView>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    setError('');setBusy(false);setReady(false);
    if(!state.active) return;
    const listener=BackHandler.addEventListener('hardwareBackPress',()=>{camera.cancel();return true;});
    return()=>listener.remove();
  },[state.active,camera]);
  if(!state.active) return null;
  const capture=async()=>{
    if(busy || !ready) return;
    setBusy(true);setError('');
    let uri:string|undefined;
    try {
      const picture=await view.current?.takePictureAsync({quality:1,exif:false});
      uri=picture?.uri;
      if(!uri) throw new Error('No se pudo tomar la imagen');
      const lines=await ocr.readAndDelete(uri);
      const result=state.kind==='identity' ? extraerIdentidad(lines) : extraerPatentes(lines);
      if(state.kind==='identity' && !result.run && !result.givenNames && !result.familyNames) throw new Error('No se reconocieron los datos. Acerca la cámara y evita reflejos.');
      if(state.kind==='plate' && !result.plates?.length) throw new Error('No se reconoció una patente. Acerca la cámara o escríbela manualmente.');
      camera.resolve(state.request,result);
    } catch(e) { setError(e instanceof Error ? e.message : 'No se pudo leer la imagen'); }
    finally { if(uri) await ocr.discard(uri).catch(()=>undefined);setBusy(false); }
  };
  return <View style={styles.layer}>
    <CameraView ref={view} style={styles.preview} facing="back" onCameraReady={()=>setReady(true)} />
    <View style={styles.footer}>
      <Text style={styles.title}>{state.kind==='identity'?'Leer nombre y RUN del carnet':'Leer patente del vehículo'}</Text>
      <Text style={styles.text}>{state.kind==='identity'?'Apunta al frente del carnet. Revisa los datos antes de registrar. La imagen se elimina después de leerla.':'Encuadra la patente de cerca y con buena luz. Confirma la lectura antes de consultar.'}</Text>
      {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}
      <Pressable disabled={!ready||busy} style={styles.button} onPress={()=>void capture()}><Text style={styles.buttonText}>{busy?'Leyendo…':'Capturar y leer'}</Text></Pressable>
      <Pressable style={styles.button} onPress={camera.cancel}><Text style={styles.buttonText}>Cancelar</Text></Pressable>
    </View>
  </View>;
}
const styles=StyleSheet.create({layer:{position:'absolute',inset:0,backgroundColor:'#000'},preview:{flex:1},footer:{padding:24,gap:12,backgroundColor:'#111827'},title:{fontSize:20,color:'#fff',fontWeight:'700'},text:{fontSize:16,color:'#fff'},error:{fontSize:16,color:'#fca5a5'},button:{minHeight:48,backgroundColor:'#fff',padding:12,borderRadius:8,alignItems:'center'},buttonText:{fontSize:17,color:'#111827',fontWeight:'600'}});
