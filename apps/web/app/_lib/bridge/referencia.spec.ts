import { armarSobre, leerMensajePortal, leerMensajeShell } from './protocol';
const id='3a0c8f7e-1111-4222-8333-444455556666';
const point={clientPointId:id,recordedAt:'2026-10-29T20:00:00.000Z',latitude:-33.4,longitude:-70.6,accuracyM:3,stationary:true,accelSamples:200,gyroSamples:200,satellitesUsed:12};
const state={active:true,walkId:id,accuracyM:3,speedMps:0,satellitesUsed:12,accelerometer:true,gyroscope:true,accelSamples:10000,gyroSamples:10000,fullGnss:true,pending:1,points:[point],error:null};
describe('puente aditivo de ronda patrón',()=>{
 it('transporta captura y sensor de movimiento con datos válidos',()=>{
   expect(leerMensajePortal(JSON.stringify(armarSobre('reference.command',{action:'start',walkId:id,maxDurationSeconds:7200}))).ok).toBe(true);
   expect(leerMensajeShell(JSON.stringify(armarSobre('reference.result',state))).ok).toBe(true);
 });
 it.each([{...point,latitude:91},{...point,accuracyM:-1},{...point,gyroSamples:-1},{...point,extra:'no autorizado'}])('rechaza mediciones malformadas %#',p=>{
   expect(leerMensajeShell(JSON.stringify(armarSobre('reference.result',{...state,points:[p]}))).ok).toBe(false);
 });
 it('rechaza exceso de lote, duración y claves inesperadas',()=>{
   expect(leerMensajeShell(JSON.stringify(armarSobre('reference.result',{...state,points:Array(51).fill(point)}))).ok).toBe(false);
   for(const payload of [{action:'start',walkId:id,maxDurationSeconds:14401},{action:'ack',walkId:id,pointIds:Array(51).fill(id)},{action:'state',password:'prohibido'}])
     expect(leerMensajePortal(JSON.stringify({...armarSobre('reference.command',{action:'state'}),payload})).ok).toBe(false);
 });
 it('mantiene el portal compatible con shells sin soporte de referencia',()=>{
   expect(leerMensajeShell(JSON.stringify(armarSobre('ready',{protocolo:{major:1,minor:6},majorsSoportados:[1],app:{version:'0.3.1'},dispositivo:{tieneNfc:true,nfcActivado:true,tieneCamara:true,nivelApiAndroid:35}}))).ok).toBe(true);
 });
});
