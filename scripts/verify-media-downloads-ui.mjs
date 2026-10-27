/* eslint-disable no-console -- Native Electron download regression with isolated local data. */
/* eslint-disable no-await-in-loop -- Wait for each native download to finish before starting the next. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const results = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const fs = req('node:fs');
        const path = req('node:path');
        const os = req('node:os');
        const file = path.join(
          process.cwd(),
          'build/models/DownloadController.js',
        );
        delete req.cache[req.resolve(file)];
        const DownloadController = req(file).default;
        const directory = fs.mkdtempSync(
          path.join(os.tmpdir(), 'zl-media-download-'),
        );
        const partition = `zl-media-download-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><button id="download">Download</button>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { partition },
        });
        const added = [];
        const ended = [];
        const controller = new DownloadController({
          ipc: { on() {}, removeListener() {} },
          getAppActions: () => ({
            addDownload: value => added.push(value),
            updateDownload() {},
            endedDownload: value => ended.push(value),
            removeDownload() {},
          }),
        });
        let pending;
        const prepare = (_event, item) => {
          item.setSavePath(path.join(directory, item.getFilename()));
          item.once('done', (_doneEvent, state) => pending?.(state));
        };
        const inspect = event => {
          if (event.defaultPrevented) pending?.('prevented');
        };
        isolated.on('will-download', prepare);
        controller.registerWebContents({
          serviceId: 'isolated-account',
          webContents: win.webContents,
        });
        isolated.on('will-download', inspect);
        try {
          await win.loadURL('https://web.whatsapp.com/');
          const fixtures = [
            {
              name: '语音.ogg',
              mime: 'audio/ogg',
              bytes: Buffer.from('OggS isolated voice bytes'),
            },
            {
              name: '图片.png',
              mime: 'image/png',
              bytes: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN8sAAAAASUVORK5CYII=',
                'base64',
              ),
            },
            {
              name: '文件.pdf',
              mime: 'application/pdf',
              bytes: Buffer.from('%PDF-1.4\nIsolated document bytes\n%%EOF'),
            },
          ];
          const nextDownload = () => {
            let timeout;
            const completion = new Promise(resolve => {
              pending = resolve;
              timeout = setTimeout(() => resolve('timeout'), 5000);
            });
            return { completion, clear: () => clearTimeout(timeout) };
          };
          const outcomes = [];
          for (const fixture of fixtures) {
            const next = nextDownload();
            await win.webContents.executeJavaScript(
              `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(fixture.bytes.toString('base64'))}),c=>c.charCodeAt(0));document.querySelector('#download').onclick=()=>{const url=URL.createObjectURL(new Blob([bytes],{type:${JSON.stringify(fixture.mime)}}));const link=document.createElement('a');link.href=url;link.download=${JSON.stringify(fixture.name)};document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)};document.querySelector('#download').click();true})()`,
            );
            const state = await next.completion;
            next.clear();
            pending = undefined;
            const target = path.join(directory, fixture.name);
            outcomes.push({
              name: fixture.name,
              state,
              sameBytes:
                fs.existsSync(target) &&
                fs.readFileSync(target).equals(fixture.bytes),
              tracked: added.at(-1)?.serviceId === 'isolated-account',
              ended: ended.at(-1)?.state,
            });
          }
          return outcomes;
        } finally {
          isolated.removeListener('will-download', prepare);
          isolated.removeListener('will-download', inspect);
          controller.dispose();
          win.destroy();
          await isolated.protocol.unhandle('https');
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }})()`,
    )})`,
  );
  for (const result of results) {
    assert.equal(
      result.state,
      'completed',
      `${result.name}: download ${result.state}`,
    );
    assert.equal(result.sameBytes, true, `${result.name}: saved bytes differ`);
    assert.equal(
      result.tracked,
      true,
      `${result.name}: wrong account attribution`,
    );
    assert.equal(
      result.ended,
      'completed',
      `${result.name}: missing completion state`,
    );
  }
  console.log(
    'PASS native voice, image and document blob downloads save exact bytes and report completion without cancelling Chromium downloads',
  );
  console.log(JSON.stringify(results));
} finally {
  socket.close();
}
