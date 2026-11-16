import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { scriptConsultaPublica } from './public-vehicle-script';

function page(options:{captcha?:boolean;response?:unknown;searched?:string}={}) {
  let submitted=0;const output:string[]=[];let tick:(()=>void)|undefined;
  const input={value:''};
  const window={IsResponse:options.response!==undefined,response:options.response,tipo_s:'1',valor_s:options.searched??'ABCD12',
    grecaptcha:{getResponse:()=>options.captcha?'valid-site-issued-token':''},
    ReactNativeWebView:{postMessage:(raw:string)=>output.push(raw)}};
  const doc={getElementById:(id:string)=>id==='txt_placa_patente'?{...input,dispatchEvent:()=>undefined}:
    id==='frmCaptcha'?{requestSubmit:()=>submitted++}:id==='cbx_pais_incripcion'?{value:'210'}:null};
  vm.runInNewContext(scriptConsultaPublica('ABCD12'),{window,document:doc,Event:function(){},setInterval:(fn:()=>void)=>{tick=fn;return 1;},clearInterval:()=>undefined});
  return {output,submitted:()=>submitted,tick:()=>tick?.()};
}
test('no consulta sin un CAPTCHA resuelto en el sitio oficial',()=>{
  const p=page();p.tick();assert.equal(p.submitted(),0);assert.deepEqual(p.output,[]);
});
test('tras resolverlo envía el formulario una sola vez',()=>{
  const p=page({captcha:true});p.tick();p.tick();assert.equal(p.submitted(),1);
});
test('solo devuelve un resultado exitoso para la patente solicitada',()=>{
  const p=page({response:{Cod:0,Result:{CodTipoEncargo:0}}});p.tick();
  assert.equal(p.output.length,1);assert.equal(JSON.parse(p.output[0]!).stolenStatus,'sin_encargo');
  assert.deepEqual(page({response:{Cod:1,Result:{CodTipoEncargo:0}}}).output,[]);
  assert.deepEqual(page({searched:'ZZZZ99',response:{Cod:0,Result:{CodTipoEncargo:0}}}).output,[]);
});
test('un resultado incompleto no se convierte en sin encargo',()=>{
  assert.deepEqual(page({response:{Cod:0,Result:{}}}).output,[]);
  assert.deepEqual(page({response:{Cod:0,Result:{CodTipoEncargo:1,Especies:[]}}}).output,[]);
});
