import assert from 'node:assert/strict';
import test from 'node:test';
import { extraerIdentidad,extraerPatentes } from './ocr-parser';
import { armarSobre,leerMensajeShell,leerMensajePortal } from '../bridge/protocol';

test('solo entrega nombre, apellidos y RUN; excluye serie, fechas y MRZ',()=>{
  const result=extraerIdentidad(['REPÚBLICA DE CHILE','APELLIDOS','PÉREZ SOTO','NOMBRES','MARÍA JOSÉ',
    'NACIONALIDAD','CHILENA','RUN 12.345.678-5','NÚMERO DOCUMENTO','999999999','FECHA NACIMIENTO','01 ENE 1990','I<CHL999999999<0000000000']);
  assert.deepEqual(result,{kind:'identity',givenNames:'MARÍA JOSÉ',familyNames:'PÉREZ SOTO',run:'12345678-5'});
  assert.equal(JSON.stringify(result).includes('999999999'),false);
});
test('no confunde una serie numérica con el RUN y deja completar datos ilegibles',()=>{
  assert.deepEqual(extraerIdentidad(['DOCUMENTO','999.999.999','FECHA','01/01/1990']),{kind:'identity'});
});
test('patentes ambiguas se devuelven para confirmar, sin inventar sustituciones',()=>{
  assert.deepEqual(extraerPatentes(['CHILE','ABCD-12','AB 1234','ABCD12','ZZY 17']),{kind:'plate',plates:['ABCD12','AB1234','ZZY17']});
});
test('el puente rechaza texto OCR completo y campos de número de documento',()=>{
  const valid=armarSobre('ocr.scan.result',{kind:'identity',run:'12345678-5'});
  assert.equal(leerMensajeShell(JSON.stringify(valid)).ok,true);
  assert.equal(leerMensajeShell(JSON.stringify({...valid,payload:{...valid.payload,documentNumber:'999999999'}})).ok,false);
  assert.equal(leerMensajeShell(JSON.stringify({...valid,payload:{...valid.payload,rawText:'carnet entero'}})).ok,false);
  assert.equal(leerMensajePortal(JSON.stringify(armarSobre('ocr.scan.start',{kind:'identity'}))).ok,true);
  assert.equal(leerMensajePortal(JSON.stringify(armarSobre('vehicle.public.start',{plate:'ABCD12'}))).ok,true);
});
