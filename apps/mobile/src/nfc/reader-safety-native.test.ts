import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const requireLocal=createRequire(import.meta.url);
const {patchNfcManagerJava}=requireLocal('../../plugins/with-nfc-reader-safety.js') as {patchNfcManagerJava:(source:string)=>string};
const javaFile=join(dirname(requireLocal.resolve('react-native-nfc-manager/package.json')),'android/src/main/java/community/revteltech/nfc/NfcManager.java');
const original=readFileSync(javaFile,'utf8');
const upstream=JSON.parse(readFileSync(new URL('./fixtures/reader-upstream-3.17.2.json',import.meta.url),'utf8')) as {callback:string;cancel:string};
const upstreamSource=upstream.callback+'\n'+upstream.cancel;
const sourceUnderTest=process.env.NFC_NATIVE_TEST_NO_PATCH==='1' ? upstreamSource : patchNfcManagerJava(original);
function method(source:string,signature:string):string {
 const at=source.indexOf(signature);assert(at>=0);let braces=1,end=source.indexOf('{',at)+1;
 for(;braces&&end<source.length;end++){if(source[end]==='{')braces++;else if(source[end]==='}')braces--;}
 return source.slice(at,end);
}
function harness(source:string):string {
 const discovered=method(source,'public void onTagDiscovered(Tag tag)'),cancel=method(source,'public void cancelTechnologyRequest(Callback callback)');
 return `import java.util.Arrays; import java.util.concurrent.*; import java.util.concurrent.atomic.*;
public class NfcManager {
 static String LOG_TAG="test",ERR_CANCEL="cancelled";
 volatile boolean isResumed=true,isForegroundEnabled=true; Tag tag; TagTechnologyRequest techRequest;
 final CountDownLatch checked=new CountDownLatch(1),resume=new CountDownLatch(1); int events=0,success=0,errors=0,conversions=0,connections=0; boolean pauseCheck;
 interface Callback {void invoke();} interface ReaderCallback {void onTagDiscovered(Tag tag);}
 static class Log {static void d(String a,String b){} static void w(String a,String b){}}
 static class WritableMap {} static class NdefMessage {}
 static class Tag {boolean stale,missing;int techReads=0,idReads=0;String[] getTechList(){techReads++;return new String[]{Ndef.class.getName()};}byte[] getId(){idReads++;return new byte[]{1};}}
 static class Ndef {static Ndef get(Tag tag){if(tag.stale)throw new SecurityException("stale");return tag.missing?null:new Ndef();}NdefMessage getCachedNdefMessage(){return null;}}
 class TagTechnologyRequest {boolean isConnected(){if(pauseCheck){checked.countDown();try{resume.await();}catch(Exception e){throw new RuntimeException(e);}}return false;}boolean connect(Tag t){connections++;return true;}void close(){}String getTechType(){return "NfcA";}void invokePendingCallback(String s){success++;}void invokePendingCallbackWithError(String s){errors++;}}
 WritableMap tag2React(Tag t){conversions++;t.getId();return new WritableMap();}WritableMap ndef2React(Ndef n,NdefMessage[] m){conversions++;return new WritableMap();}void sendEvent(String n,WritableMap m){events++;}
 ReaderCallback reader(){final NfcManager manager=this;return new ReaderCallback(){${discovered}};}
 ${cancel}
 public static void main(String[] args)throws Exception {
  String mode=args[0];NfcManager manager=new NfcManager();manager.techRequest=manager.new TagTechnologyRequest();Tag tag=new Tag();
  if(mode.equals("race")){manager.pauseCheck=true;AtomicReference<Throwable> failure=new AtomicReference<>();
   Thread discovery=new Thread(()->{try{manager.reader().onTagDiscovered(tag);}catch(Throwable e){failure.set(e);}});discovery.start();
   if(!manager.checked.await(2,TimeUnit.SECONDS))throw new AssertionError("discovery not reached");CountDownLatch cancelled=new CountDownLatch(1);
   Thread cancellation=new Thread(()->{manager.cancelTechnologyRequest(()->{});cancelled.countDown();});cancellation.start();
   cancelled.await(100,TimeUnit.MILLISECONDS);manager.resume.countDown();discovery.join(2000);cancellation.join(2000);
   if(discovery.isAlive()||cancellation.isAlive())throw new AssertionError("reader deadlock");if(failure.get()!=null)throw new AssertionError("discovery escaped",failure.get());
  }else{if(mode.equals("stale"))tag.stale=true;if(mode.equals("missing"))tag.missing=true;if(mode.equals("camera"))manager.isResumed=false;if(mode.equals("idle"))manager.techRequest=null;
   manager.reader().onTagDiscovered(tag);if((mode.equals("camera")||mode.equals("idle"))&&(manager.events!=0||manager.conversions!=0||manager.connections!=0||tag.techReads!=0||tag.idReads!=0||manager.tag!=null))throw new AssertionError("tag inspected without an active foreground scan");
   if(mode.equals("stale")&&manager.errors!=1)throw new AssertionError("recoverable failure not returned");}
  System.out.println(mode+":ok");
 }
}`;
}
function run(source:string,mode:string):void {
 const root=mkdtempSync(join(tmpdir(),'nfc-native-'));
 try {writeFileSync(join(root,'NfcManager.java'),harness(source));execFileSync('javac',[join(root,'NfcManager.java')],{stdio:'pipe'});execFileSync('java',['-cp',root,'NfcManager',mode],{stdio:'pipe',timeout:10000});}
 finally{rmSync(root,{recursive:true,force:true});}
}
test('the actual upstream callback reproduces cancellation and Android tag failures',()=>{
 if(!original.includes('// SentryCore: serialize'))assert.equal(method(original,'public void onTagDiscovered(Tag tag)'),upstream.callback);
 for(const mode of ['race','stale','missing','camera','idle'])assert.throws(()=>run(upstreamSource,mode));
});
test('patched real Java callback survives failures and never inspects tags while idle or in the camera',()=>{
 for(const mode of ['race','stale','missing','camera','idle'])run(sourceUnderTest,mode);
});
test('the native patch is idempotent and refuses an unknown callback layout',()=>{
 const result=patchNfcManagerJava(original);assert.equal(patchNfcManagerJava(result),result);assert.throws(()=>patchNfcManagerJava('unsupported version'));
 const fresh=original.replace(method(original,'public void onTagDiscovered(Tag tag)'),upstream.callback)
  .replace('private volatile Boolean isResumed = false;','private Boolean isResumed = false;')
  .replace('private volatile Boolean isForegroundEnabled = false;','private Boolean isForegroundEnabled = false;');
 assert.equal(patchNfcManagerJava(fresh),result);
 assert.throws(()=>patchNfcManagerJava(result.replace('synchronized (manager)','synchronized (other)')));
});
