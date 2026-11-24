import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceBrowser } from '../device.mjs';

test('device metadata follows the actual OS without impersonating macOS on Windows', () => {
  assert.deepEqual(deviceBrowser('win32', '10.0.26100'), [
    'Windows',
    'Chrome',
    '10.0.26100',
  ]);
  assert.deepEqual(deviceBrowser('darwin', '25.1.0'), [
    'Mac OS',
    'Chrome',
    '25.1.0',
  ]);
  assert.deepEqual(deviceBrowser('linux', '6.8.0'), [
    'Ubuntu',
    'Chrome',
    '6.8.0',
  ]);
});
