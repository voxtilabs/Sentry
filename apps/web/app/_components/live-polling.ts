/** Poll only visible pages, cancel hung calls, and never overlap requests. */
export function startLivePolling<T>({load,onData,onError,intervalMs=5000,isVisible=()=>true}: {
  load:(signal:AbortSignal)=>Promise<T>;onData:(data:T)=>void;onError:(error:unknown)=>void;
  intervalMs?:number;isVisible?:()=>boolean;
}): {refresh:()=>Promise<void>;stop:()=>void} {
  let stopped=false;let pending=false;let controller:AbortController|undefined;
  const refresh=async()=>{
    if(stopped||pending||!isVisible())return;
    pending=true;controller=new AbortController();const current=controller;
    const timeout=setTimeout(()=>current.abort(),12000);
    try{const data=await load(current.signal);if(!stopped)onData(data);}
    catch(error){if(!stopped)onError(error);}
    finally{clearTimeout(timeout);pending=false;}
  };
  void refresh();const timer=setInterval(()=>void refresh(),intervalMs);
  return {refresh,stop:()=>{stopped=true;clearInterval(timer);controller?.abort();}};
}
