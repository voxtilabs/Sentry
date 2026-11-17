import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEscuchaLogin,type LoginReaderPort } from './login-reader';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function port(patch:Partial<LoginReaderPort>={}):LoginReaderPort{return{start:async()=>{},supported:async()=>true,enabled:async()=>true,reserve:async()=>{},request:async()=>{},read:async()=>({id:'04aabbcc'}),cancel:async()=>{},confirm:()=>{},...patch};}
test('stopping during availability never starts a late native read',async()=>{
 const started=deferred<void>();let requests=0,cancellations=0;
 const login=crearEscuchaLogin(port({start:()=>started.promise,request:async()=>{requests++;},cancel:async()=>{cancellations++;}}));
 const running=login.iniciar(()=>assert.fail('late login tag'));await tick();await login.detener();started.resolve();await running;
 assert.equal(requests,0);assert.equal(cancellations,0);
});
test('stop resolves only after old native cleanup and cannot cancel a later point',async()=>{
 const native=deferred<void>(),cleanup=deferred<void>();let cancellations=0,pointStarted=false;
 const login=crearEscuchaLogin(port({request:()=>native.promise,cancel:async()=>{cancellations++;assert(!pointStarted);native.reject(Error('cancelled'));await cleanup.promise;}}));
 const running=login.iniciar(()=>assert.fail('cancelled login tag'));await tick();let stopped=false;
 const stop=login.detener().then(()=>{stopped=true;});await tick();assert.equal(stopped,false);cleanup.resolve();await stop;await running;pointStarted=true;await tick();assert.equal(cancellations,1);
});
test('a new login session is not stopped by a cancelled start continuation',async()=>{
 const first=deferred<void>();let starts=0,reads=0;
 const login=crearEscuchaLogin(port({start:()=>++starts===1?first.promise:Promise.resolve(),read:async()=>{reads++;return{id:'04aabbcc'};}}));
 const old=login.iniciar(()=>assert.fail('old callback'));await tick();await login.detener();
 const fresh=login.iniciar(()=>{});await tick();first.resolve();await old;assert.equal(reads,1);await login.detener();await fresh;
});
test('stop interrupts the post-tag debounce without cancelling twice',async()=>{
 let detections=0,cancels=0;const login=crearEscuchaLogin(port({cancel:async()=>{cancels++;}}));
 const running=login.iniciar(()=>{detections++;});await tick();const at=Date.now();await login.detener();await running;
 assert.equal(detections,1);assert.equal(cancels,1);assert(Date.now()-at<300);
});
