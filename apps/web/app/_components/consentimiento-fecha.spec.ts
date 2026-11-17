import { execFileSync } from 'node:child_process';
import type { AvisoConsentimiento } from './consentimiento-aviso';

const aviso: AvisoConsentimiento = {
 hasPolicy:true,policy:{version:'fixture',body:'Aviso de prueba',privacyPolicyUrl:'https://example.test/privacy',publishedAt:'2026-11-17T15:00:00.000Z'},
 acceptance:{status:'nunca_aceptado',acceptedVersion:null,grantedAt:null,revokedAt:null,deviceInfo:null},
 tracking:{enabled:true,sampleIntervalSeconds:30,retentionDays:90},actionRequired:'aceptar',
};
function render(zone:string, input=aviso) {
 const script=`const {createElement}=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {ConsentimientoAviso}=require(${JSON.stringify(require.resolve('./consentimiento-aviso'))});process.stdout.write(renderToStaticMarkup(createElement(ConsentimientoAviso,{aviso:${JSON.stringify(input)},apiUrl:'/api'})));`;
 return execFileSync(process.execPath,['-r',require.resolve('ts-node/register/transpile-only'),'-e',script],{encoding:'utf8',env:{...process.env,TZ:zone,TS_NODE_SKIP_PROJECT:'true',TS_NODE_COMPILER_OPTIONS:JSON.stringify({module:'CommonJS',moduleResolution:'Node',jsx:'react-jsx',target:'ES2022',esModuleInterop:true})}});
}
describe('SSR del aviso de geolocalización',()=>{
 it('conserva el texto inicial cuando servidor y navegador usan zonas diferentes',()=>{
  expect(render('UTC')).toBe(render('America/Santiago'));
 });
 it('conserva los instantes y las opciones legales sin registrar decisiones durante SSR',()=>{
  const accepted:AvisoConsentimiento={...aviso,acceptance:{...aviso.acceptance,status:'vigente',acceptedVersion:'fixture',grantedAt:'2026-11-16T15:00:00.000Z'},actionRequired:'ninguna'};
  const markup=render('Pacific/Auckland',accepted);expect(markup).toBe(render('America/Santiago',accepted));
  expect(markup).toContain('2026-11-17T15:00:00.000Z');expect(markup).toContain('2026-11-16T15:00:00.000Z');expect(markup).toContain('Retirar mi consentimiento');
 });
});
