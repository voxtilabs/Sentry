import * as Location from 'expo-location';
import type { PosicionEscaneo } from '../nfc/nfc-reader';

/** A scan has a timestamp of its own. Never attach an old position to it. */
export async function posicionDelEscaneo(): Promise<PosicionEscaneo | undefined> {
  let finished = false;
  let subscription: Location.LocationSubscription | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    if ((await Location.getForegroundPermissionsAsync()).status !== 'granted' || finished) return;
    const recent = await Location.getLastKnownPositionAsync({ maxAge: 5_000, requiredAccuracy: 15 });
    if (finished) return;
    if (recent) return recent.coords;
    return new Promise<Location.LocationObjectCoords | undefined>((resolve, reject) => {
      void Location.watchPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation, mayShowUserSettingsDialog: false,
      }, fix => {
        if (Math.abs(Date.now() - fix.timestamp) <= 5_000) resolve(fix.coords);
      }, () => resolve(undefined)).then(handle => {
        if (finished) handle.remove();
        else subscription = handle;
      }, reject);
    });
  };
  try {
    const coords = await Promise.race([
      read(), new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 3_000); }),
    ]);
    if (!coords) return undefined;
    return { latitude: coords.latitude, longitude: coords.longitude,
      ...(coords.accuracy === null ? {} : { accuracyM: coords.accuracy }) };
  } finally {
    finished = true;
    clearTimeout(timeout);
    subscription?.remove();
  }
}
