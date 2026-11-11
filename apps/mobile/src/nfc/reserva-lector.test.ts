import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearReservaLector } from './reserva-lector';

test('login y escaneo comparten inscripción y los fallos permiten reintentar', async () => {
  const reservar=crearReservaLector();let llamadas=0;
  await assert.rejects(reservar(async()=>{llamadas++;throw Error('NFC apagado')}));
  let liberar!:()=>void;const espera=new Promise<void>(r=>{liberar=r});
  const registrar=async()=>{llamadas++;await espera};
  const login=reservar(registrar),ronda=reservar(registrar);
  assert.equal(login,ronda);liberar();await Promise.all([login,ronda]);
  await reservar(registrar);assert.equal(llamadas,2);
});
test('ambos consumidores reservan el lector antes de solicitar la tecnología',()=>{
  for(const archivo of ['native-port.ts','login-nfc-listener.ts']){
    const fuente=readFileSync(join(__dirname,archivo),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
    const reserva=fuente.indexOf('await reservarLector('),solicitud=fuente.indexOf('await NfcManager.requestTechnology(');
    assert.ok(reserva>=0&&reserva<solicitud,`${archivo}: falta reserva independiente antes del escaneo`);
    assert.ok(!fuente.includes('unregisterTagEvent('));
  }
});
