import assert from 'node:assert/strict';
import test from 'node:test';
import { androidExitReport } from './android-exit';

const now = Date.parse('2026-11-19T15:00:00Z');
const sample = { cause: 'anr', timeMs: now - 1_000, status: 0, importance: 100 };

test('reporta la causa comprobada por Android y la hora real incluso tras segundo plano', () => {
  assert.deepEqual(androidExitReport(sample, 0, false, now), {
    errorName: 'AndroidANR',
    errorMessage: 'Motivo de Android: anr. Estado: 0. Importancia: 100.',
    fatal: true,
    occurredAt: '2026-11-19T14:59:59.000Z',
  });
  assert.equal(androidExitReport({ ...sample, cause: 'low_memory' }, 0, true, now)?.fatal, false);
});

test('no reenvía un evento, registra un cierre intencional ni acepta causas arbitrarias', () => {
  assert.equal(androidExitReport(sample, sample.timeMs, true, now), undefined);
  assert.equal(androidExitReport({ ...sample, cause: 'expected' }, 0, true, now), undefined);
  assert.equal(androidExitReport({ ...sample, cause: 'unspecified' }, 0, false, now), undefined);
  assert.equal(androidExitReport({ ...sample, cause: 'toString' }, 0, true, now), undefined);
});
