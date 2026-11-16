import { requireNativeModule } from 'expo-modules-core';
export default requireNativeModule<{
  readAndDelete(uri: string): Promise<string[]>;
  discard(uri: string): Promise<void>;
}>('SentryOcr');
