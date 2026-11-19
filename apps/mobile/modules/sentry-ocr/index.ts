import { requireNativeModule } from 'expo-modules-core';
export default requireNativeModule<{
  readAndDelete(uri: string, plateOnly: boolean): Promise<string[]>;
  discard(uri: string): Promise<void>;
}>('SentryOcr');
