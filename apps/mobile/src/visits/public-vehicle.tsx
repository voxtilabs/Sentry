import { scriptConsultaPublica } from './public-vehicle-script';
import { useEffect, useSyncExternalStore } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ResultadoConsultaPublicaPayload } from '../bridge/protocol';

const ORIGIN='https://www.autoseguro.gob.cl';

export function crearConsultaPublica() {
  let state:{active:false}|{active:true;plate:string}={active:false};
  let resolve:((r:ResultadoConsultaPublicaPayload)=>void)|undefined;
  let reject:((e:Error)=>void)|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const listeners=new Set<()=>void>();
  const close=()=>{if(timer)clearTimeout(timer);resolve=undefined;reject=undefined;state={active:false};listeners.forEach(f=>f());};
  const cancel=()=>{reject?.(new Error('Consulta pública cancelada'));close();};
  return {
    snapshot:()=>state,
    subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
    cancel,
    start:(plate:string):Promise<ResultadoConsultaPublicaPayload>=>{
      cancel();
      if(!/^[A-Z0-9]{5,6}$/.test(plate))return Promise.reject(new Error('Patente no válida'));
      return new Promise((yes,no)=>{resolve=yes;reject=no;state={active:true,plate};listeners.forEach(f=>f());timer=setTimeout(cancel,5*60_000);});
    },
    receive:(raw:string,url:string)=>{
      try {
        if(!state.active||new URL(url).origin!==ORIGIN||raw.length>1000)return;
        const result=JSON.parse(raw) as ResultadoConsultaPublicaPayload;
        if(result.source!=='autoseguro'||result.plate!==state.plate||!['sin_encargo','con_encargo','encargo_parcial'].includes(result.stolenStatus)||!Number.isFinite(Date.parse(result.checkedAt)))return;
        resolve?.({source:'autoseguro',plate:state.plate,stolenStatus:result.stolenStatus,checkedAt:result.checkedAt});close();
      }catch{}
    },
  };
}

export function VistaConsultaPublica({consulta}:{consulta:ReturnType<typeof crearConsultaPublica>}) {
  const state=useSyncExternalStore(consulta.subscribe,consulta.snapshot,consulta.snapshot);
  useEffect(()=>{
    if(!state.active)return;
    const listener=BackHandler.addEventListener('hardwareBackPress',()=>{consulta.cancel();return true;});
    return()=>listener.remove();
  },[state.active,consulta]);
  if(!state.active)return null;
  return <View style={styles.layer}>
    <View style={styles.header}><Text style={styles.title}>Auto Seguro · {state.plate}</Text>
      <Text style={styles.text}>Completa el CAPTCHA en la página oficial. La patente se ingresa y el resultado se recupera automáticamente.</Text>
      <Pressable style={styles.button} onPress={consulta.cancel}><Text style={styles.text}>Volver al registro</Text></Pressable></View>
    <WebView source={{uri:ORIGIN+'/'}} javaScriptEnabled domStorageEnabled incognito sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled originWhitelist={['https://*']} injectedJavaScript={scriptConsultaPublica(state.plate)}
      onShouldStartLoadWithRequest={req=>{
        if(req.isTopFrame===false)return true;
        try{return new URL(req.url).origin===ORIGIN;}catch{return false;}
      }}
      onMessage={event=>consulta.receive(event.nativeEvent.data,event.nativeEvent.url)}
      onError={()=>consulta.cancel()} style={styles.web}/>
  </View>;
}
const styles=StyleSheet.create({layer:{position:'absolute',inset:0,backgroundColor:'#fff'},header:{padding:16,gap:8,borderBottomWidth:1,borderBottomColor:'#dbe1e8'},title:{fontSize:18,fontWeight:'700',color:'#172033'},text:{fontSize:16,color:'#172033'},button:{minHeight:48,justifyContent:'center'},web:{flex:1}});
