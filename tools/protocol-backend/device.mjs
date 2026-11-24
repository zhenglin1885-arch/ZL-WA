import { release } from 'node:os';

// Device metadata only; never changes auth keys, protocol version or pairing flow.
export function deviceBrowser(
  platform = process.platform,
  osVersion = release(),
) {
  return [
    platform === 'win32'
      ? 'Windows'
      : platform === 'darwin'
        ? 'Mac OS'
        : 'Ubuntu',
    'Chrome',
    osVersion,
  ];
}
