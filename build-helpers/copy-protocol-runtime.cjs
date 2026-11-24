const { cp, access } = require('node:fs/promises');
const path = require('node:path');

// electron-builder's generic file matcher omits nested node_modules even in
// extraResources. Copy the separately installed runtime explicitly after packing,
// including nested dependency versions and the build OS's native codecs.
module.exports = async function copyProtocolRuntime(context) {
  const source = path.join(
    context.packager.projectDir,
    'tools',
    'protocol-backend',
    'node_modules',
  );
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const destination = path.join(resources, 'protocol-backend', 'node_modules');
  const required = [
    '@whiskeysockets/baileys/package.json',
    'ffmpeg-static/index.js',
    'sharp/package.json',
  ];
  for (const name of required) await access(path.join(source, name));
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
  });
  for (const name of required) await access(path.join(destination, name));
};
