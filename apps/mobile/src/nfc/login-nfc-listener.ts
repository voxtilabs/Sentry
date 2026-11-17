import { reservarLector } from './reserva-lector';
import { crearEscuchaLogin } from './login-reader';
import { Vibration } from 'react-native';
import NfcManager, { NfcAdapter, NfcTech } from 'react-native-nfc-manager';

const FAMILIAS_QUE_ESCUCHA =
  NfcAdapter.FLAG_READER_NFC_A |
  NfcAdapter.FLAG_READER_NFC_B |
  NfcAdapter.FLAG_READER_NFC_F |
  NfcAdapter.FLAG_READER_NFC_V |
  NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;

const login = crearEscuchaLogin({
  start: () => NfcManager.start(),
  supported: () => NfcManager.isSupported(),
  enabled: () => NfcManager.isEnabled(),
  reserve: async () => {
    await reservarLector(() => NfcManager.registerTagEvent({
      isReaderModeEnabled: true, readerModeFlags: FAMILIAS_QUE_ESCUCHA,
    }));
  },
  request: async () => {
    await NfcManager.requestTechnology(
      [NfcTech.NfcA, NfcTech.NfcB, NfcTech.NfcF, NfcTech.NfcV, NfcTech.MifareUltralight],
      { isReaderModeEnabled: true, readerModeFlags: FAMILIAS_QUE_ESCUCHA },
    );
  },
  read: () => NfcManager.getTag(),
  cancel: () => NfcManager.cancelTechnologyRequest({ throwOnError: false }),
  confirm: () => Vibration.vibrate(80),
});
export const iniciarEscuchaNfcLogin = login.iniciar;
export const detenerEscuchaNfcLogin = login.detener;
