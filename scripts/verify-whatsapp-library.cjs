/* Verify the exact compatibility library inside the installable app, not only
 * the source tree or an unpacked build directory. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const prepareLibrary = require('../build-helpers/prepare-whatsapp-library.cjs');
const builderRequire = createRequire(require.resolve('electron-builder'));
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { extractFile, listPackage } = appRequire('@electron/asar');
const archive = process.argv[2];
assert(archive, 'Provide the packaged app.asar path');
const source = readFileSync(
  'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js',
  'utf8',
);
const packaged = extractFile(archive, 'wppconnect-wa.js').toString('utf8');
assert.equal(packaged, prepareLibrary(source));
assert(packaged.includes('ZL_WA_LID_COMPAT_V1'));
assert(packaged.includes('ZL_WA_NATIVE_CONNECTION_V1'));
assert(packaged.includes('__zlNativeConnectionCompat'));
const files = listPackage(archive);
assert(
  !files.some(p =>
    /\/features\/protocol\/|\/electron\/(?:ProtocolConnections|OfficialWhatsAppLogin)\.js$/.test(
      p,
    ),
  ),
  'Retired login experiments must not be packaged',
);
console.log(
  'PASS packaged WhatsApp library matches the tested LID and native connection compatibility adapters',
);
