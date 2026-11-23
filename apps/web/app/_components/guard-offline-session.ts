import type { GuardShiftData } from './guard-shift';
import { borrarClave, escribirJson, leerJson } from './guard-storage';

const KEY = 'sentrycore.guard.active-round.v1';

export function forgetOfflineRound() { borrarClave(KEY); }

export function rememberOfflineRound(data: GuardShiftData) {
  if (!data.shift || !data.patrol || !['en_curso','pausada'].includes(data.patrol.status)) {
    forgetOfflineRound();
    return;
  }
  // Pick the screen's fields. The API also supplies tag UIDs and staff details.
  const {id,status,siteName,timezone,routeName,isFreeRoam,estimatedDurationMin,completedCheckpointCount,checkpoints} = data.patrol;
  escribirJson(KEY, {
    hasAssignment:true, shift:data.shift, photoBudget:data.photoBudget, qrFallbackEnabled:data.qrFallbackEnabled,
    photoPolicy:data.photoPolicy, synchronization:{pendingItems:0},
    patrol:{id,status,siteName,timezone,routeName,isFreeRoam,estimatedDurationMin,completedCheckpointCount,
      checkpoints:checkpoints.map(({id,name,position,isClosingPoint,kind,requiresPhoto,latitude,longitude,scannedAt}) =>
        ({id,name,position,isClosingPoint,kind,requiresPhoto,latitude,longitude,scannedAt}))},
  });
}

export function readOfflineRound(): GuardShiftData | null {
  const data = leerJson<GuardShiftData | null>(KEY, null);
  const end = Date.parse(data?.shift?.scheduledEndAt ?? '');
  if (!data?.patrol || !Array.isArray(data.patrol.checkpoints) || !Number.isFinite(end) ||
      Date.now() > end + 12 * 60 * 60_000) {
    forgetOfflineRound();
    return null;
  }
  return data;
}

let preparing: Promise<void> | undefined;
export function prepareOfflineScreen() {
  if (!('serviceWorker' in navigator)) return;
  if (!navigator.onLine) {
    window.addEventListener('online',prepareOfflineScreen,{once:true});
    return;
  }
  preparing ??= (async () => {
    await navigator.serviceWorker.register('/sw-tiles.js');
    const worker = (await navigator.serviceWorker.ready).active;
    if (!worker) throw Error();
    await new Promise<void>((resolve,reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {channel.port1.close();reject(Error());},25_000);
      channel.port1.onmessage = ({data}) => {
        clearTimeout(timer);channel.port1.close();
        if (data === true) resolve(); else reject(Error());
      };
      worker.postMessage({type:'prepare-round-screen'},[channel.port2]);
    });
  })().catch(() => {
    preparing = undefined;
    window.addEventListener('online',prepareOfflineScreen,{once:true});
  });
}
