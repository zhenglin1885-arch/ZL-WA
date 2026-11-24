import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const copy = require('../build-helpers/copy-protocol-runtime.cjs');
it('copies root and nested protocol dependencies, including native binary bytes, into Windows resources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zl-protocol-pack-'));
  try {
    const source = join(root, 'tools/protocol-backend/node_modules');
    const files: Record<string, string> = {
      '@whiskeysockets/baileys/package.json': '{}',
      'ffmpeg-static/index.js': 'module.exports="ffmpeg.exe"',
      'sharp/package.json': '{}',
      'pino/node_modules/nested/index.js': 'nested dependency',
      '@img/sharp-win32-x64/lib/sharp.node': 'native fixture bytes',
    };
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(source, name)), { recursive: true });
      writeFileSync(join(source, name), content);
    }
    await copy({
      packager: { projectDir: root, appInfo: { productFilename: 'ZL-WA' } },
      electronPlatformName: 'win32',
      appOutDir: join(root, 'out'),
    });
    for (const [name, content] of Object.entries(files))
      expect(
        readFileSync(
          join(root, 'out/resources/protocol-backend/node_modules', name),
          'utf8',
        ),
      ).toBe(content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('refuses to produce an empty runtime when the separate dependency installation is missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zl-protocol-pack-missing-'));
  try {
    await expect(
      copy({
        packager: { projectDir: root },
        electronPlatformName: 'win32',
        appOutDir: join(root, 'out'),
      }),
    ).rejects.toThrow();
    expect(
      existsSync(join(root, 'out/resources/protocol-backend/node_modules')),
    ).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
