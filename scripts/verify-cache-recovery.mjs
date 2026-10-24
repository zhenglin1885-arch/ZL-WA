/* eslint-disable no-console -- Sequential native startup and restart phases. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'zl-cache-recovery-native-'));
const profile = join(root, 'profile');
mkdirSync(profile);
mkdirSync(join(root, 'Software', 'ZL-WA', 'AppData'), { recursive: true });
mkdirSync(join(root, 'safe'));
writeFileSync(
  join(root, 'fixture.html'),
  '<!doctype html><title>Local storage fixture</title>',
);
writeFileSync(join(profile, 'chat-backup-preserved'), 'backup metadata');
const configFile = join(profile, 'cache-location.json');
const run = phase =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/electron/cli.js',
        fileURLToPath(
          new URL('fixtures/cache-recovery-main.cjs', import.meta.url),
        ),
        '--disable-gpu',
        '--no-sandbox',
      ],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ':98',
          ZL_WA_APPDATA_DIR: profile,
          ZL_CACHE_RECOVERY_ROOT: root,
          ZL_CACHE_RECOVERY_PHASE: phase,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timeout in ${phase}: ${output.slice(-2000)}`));
    }, 60_000);
    child.stdout.on('data', data => {
      output += data;
    });
    child.stderr.on('data', data => {
      output += data;
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === (phase === 'cancel' ? 1 : 0)) {
        console.log(`PASS ${phase}`);
        resolve();
      } else {
        reject(new Error(`${phase} exited ${code}: ${output.slice(-4000)}`));
      }
    });
  });
try {
  await run('seed');
  await run('custom');
  const old = JSON.parse(readFileSync(configFile, 'utf8'));
  renameSync(old.active, join(root, 'restored'));
  rmSync(join(root, 'Software'), { recursive: true });
  await run('restore');
  assert.equal(
    JSON.parse(readFileSync(configFile, 'utf8')).active,
    join(root, 'restored'),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, 'restore.json'), 'utf8')),
    { restarted: true, windows: 0, contents: 0, code: 0 },
  );
  await run('restored-verify');
  await run('boot-restored');
  const missing = {
    ...JSON.parse(readFileSync(configFile, 'utf8')),
    active: join(root, 'removed', 'AppData', 'ZL-WA缓存'),
  };
  writeFileSync(configFile, JSON.stringify(missing));
  const original = readFileSync(configFile, 'utf8');
  await run('cancel');
  assert.equal(readFileSync(configFile, 'utf8'), original);
  await run('fresh');
  const fresh = JSON.parse(readFileSync(configFile, 'utf8'));
  assert(fresh.active.startsWith(join(root, 'safe')));
  assert(
    readdirSync(profile)
      .filter(n => n.startsWith('cache-location.recovery-'))
      .some(n => readFileSync(join(profile, n), 'utf8') === original),
  );
  await run('fresh-verify');
  await run('boot-fresh');
  assert.equal(
    readFileSync(join(profile, 'chat-backup-preserved'), 'utf8'),
    'backup metadata',
  );
  console.log(
    'PASS real startup recovery before any main window/account opens, clean restart, preserved Cookies/localStorage/IndexedDB, explicit fresh login and cancellation',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
