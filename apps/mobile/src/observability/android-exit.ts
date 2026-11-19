export interface AndroidExit {
  cause: string;
  timeMs: number;
  status: number;
  importance: number;
}

const causes = {
  java_crash: { errorName: 'AndroidJavaCrash', fatal: true },
  native_crash: { errorName: 'AndroidNativeCrash', fatal: true },
  anr: { errorName: 'AndroidANR', fatal: true },
  initialization_failure: { errorName: 'AndroidInitializationFailure', fatal: true },
  low_memory: { errorName: 'AndroidLowMemory', fatal: false },
  resource_limit: { errorName: 'AndroidSystemExit', fatal: false },
  signal: { errorName: 'AndroidSystemExit', fatal: false },
  dependency_died: { errorName: 'AndroidSystemExit', fatal: false },
  unspecified: { errorName: 'AndroidSystemExit', fatal: false },
} as const;

export function androidExitReport(record: AndroidExit, lastTime: number, wasUnclean: boolean, now = Date.now()) {
  if (!Number.isSafeInteger(record.timeMs) || record.timeMs <= lastTime ||
      record.timeMs > now + 60_000 || record.timeMs < now - 7 * 86_400_000) return undefined;
  if (!Object.prototype.hasOwnProperty.call(causes, record.cause)) return undefined;
  if (record.cause === 'unspecified' && !wasUnclean) return undefined;
  const reason = record.cause as keyof typeof causes;
  const number = (value: number) => Number.isSafeInteger(value) && Math.abs(value) <= 10_000 ? value : 0;
  return {
    ...causes[reason],
    occurredAt: new Date(record.timeMs).toISOString(),
    errorMessage: `Motivo de Android: ${reason}. Estado: ${number(record.status)}. Importancia: ${number(record.importance)}.`,
  };
}
