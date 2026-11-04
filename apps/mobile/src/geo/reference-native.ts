import { requireOptionalNativeModule } from 'expo';
import type { ReferenceCommand, ReferenceState } from '../bridge/protocol';
const native = requireOptionalNativeModule<{ command(raw: string): Promise<string> }>('SentryReferenceGps');
export const referenceAvailable = native !== null;
export async function referenceCommand(command: ReferenceCommand): Promise<ReferenceState> {
  if (!native) throw new Error('capture-unavailable');
  return JSON.parse(await native.command(JSON.stringify(command))) as ReferenceState;
}
export function stopReference() { void referenceCommand({ action: 'stop' }).catch(() => undefined); }
