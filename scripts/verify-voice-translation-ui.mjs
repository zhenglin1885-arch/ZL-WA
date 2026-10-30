/* eslint-disable unicorn/consistent-function-scoping -- Helpers must stay inside the serialized guest proof. */
/* eslint-disable no-console -- Offline native Chromium regression output. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, socket } from './account-tools-cdp.mjs';

const oggFile = process.env.ZL_VOICE_PROOF_OGG
  ? readFileSync(process.env.ZL_VOICE_PROOF_OGG).toString('base64')
  : '';
try {
  const proof = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const fs = req('node:fs');
        const vm = req('node:vm');
        const { BrowserWindow, session } = req('electron');
        const module = { exports: {} };
        vm.runInNewContext(
          fs.readFileSync(
            `${process.cwd()}/build/features/accountTools/voiceTranslationGuest.js`,
            'utf8',
          ),
          { module, exports: module.exports },
        );
        const guest = module.exports;
        const partition = `zl-voice-translation-proof-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(
              '<html><body><div id="main"><div data-id="false_10001@c.us_A"><button data-icon="audio-play">Play</button></div><div data-id="false_10001@c.us_B"><button data-icon="audio-play">Play</button></div><div data-id="false_10002@c.us_C"><button data-icon="audio-play">Other chat</button></div><div data-id="false_10001@c.us_D">Plain text</div></div></body></html>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          width: 900,
          height: 700,
          webPreferences: { partition },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          return await win.webContents.executeJavaScript(
            `(${async function run(tick, read, result, current, ogg) {
              const check = (condition, message) => {
                if (!condition) throw new Error(message);
              };
              let chat = '10001@c.us';
              window.__zlTranslation = {
                chatKey: () => chat,
                notice() {},
                withScroll: (_node, operation) => operation(),
              };
              let downloaded = 0;
              const wav = new ArrayBuffer(32_044);
              const v = new DataView(wav);
              const word = (n, text) => {
                for (let i = 0; i < text.length; i += 1)
                  v.setUint8(n + i, text.codePointAt(i));
              };
              word(0, 'RIFF');
              v.setUint32(4, 32_036, true);
              word(8, 'WAVEfmt ');
              v.setUint32(16, 16, true);
              v.setUint16(20, 1, true);
              v.setUint16(22, 1, true);
              v.setUint32(24, 16_000, true);
              v.setUint32(28, 32_000, true);
              v.setUint16(32, 2, true);
              v.setUint16(34, 16, true);
              word(36, 'data');
              v.setUint32(40, 32_000, true);
              for (let i = 0; i < 16_000; i += 1)
                v.setInt16(
                  44 + i * 2,
                  Math.sin((i * 2 * Math.PI * 440) / 16_000) * 16_000,
                  true,
                );
              window.WPP = {
                isReady: true,
                chat: {
                  getMessageById: async id => ({ id, type: 'ptt' }),
                  downloadMedia: async () => {
                    downloaded += 1;
                    return ogg
                      ? new Blob(
                          [Uint8Array.from(atob(ogg), c => c.codePointAt(0))],
                          { type: 'audio/ogg; codecs=opus' },
                        )
                      : new Blob([wav], { type: 'audio/wav' });
                  },
                },
              };
              tick(true, 'config1');
              tick(true, 'config1');
              check(
                document.querySelectorAll('[data-zl-voice-translation]')
                  .length === 2,
                'Voice controls missing, duplicated, or attached to text/wrong chat',
              );
              check(
                downloaded === 0 && tick(true, 'config1').length === 0,
                'Voice auto-uploaded',
              );
              const first = document.querySelector(
                '[data-id="false_10001@c.us_A"]',
              );
              first.querySelector('[data-zl-voice-translation] button').click();
              document
                .querySelector(
                  '[data-id="false_10001@c.us_B"] [data-zl-voice-translation] button',
                )
                .click();
              const jobs = tick(true, 'config1');
              check(jobs.length === 1, 'Parallel clicks should be bounded');
              check(current(jobs[0]), 'Clicked message not current');
              const media = await read(jobs[0]);
              const decoded = Uint8Array.from(atob(media.audio), c =>
                c.codePointAt(0),
              );
              const data = new DataView(decoded.buffer);
              check(
                data.getUint32(24, true) === 16_000 &&
                  decoded.length >= 30_044 &&
                  decoded.length <= 34_044 &&
                  data.getUint32(40, true) === decoded.length - 44,
                'Native decoded WAV has wrong encoding',
              );
              check(downloaded === 1, 'Downloaded more than the clicked voice');
              check(
                result(jobs[0], {
                  error: true,
                  transcript: 'Bom dia',
                  message: 'Synthetic translation timeout',
                }),
                'Error not rendered',
              );
              first.querySelector('[data-zl-voice-translation] button').click();
              const retry = tick(true, 'config1')[0];
              const retried = await read(retry);
              check(
                retried.transcript === 'Bom dia' && downloaded === 1,
                'Retry reuploaded transcribed audio',
              );
              check(
                result(retry, { text: '早上好', transcript: 'Bom dia' }),
                'Translation not rendered',
              );
              check(
                first.textContent.includes('早上好') &&
                  first.textContent.includes('Bom dia'),
                'Missing transcript/translation',
              );
              first.querySelector('[data-zl-voice-translation] button').click();
              const stale = tick(true, 'config1')[0];
              chat = '10002@c.us';
              check(
                !current(stale) && !result(stale, { text: 'Wrong chat' }),
                'Old result leaked to another chat',
              );
              await read(stale).then(
                () => {
                  throw new Error('Read accepted stale chat');
                },
                () => {},
              );
              chat = '10001@c.us';
              tick(true, 'config2');
              check(
                !result(stale, { text: 'Wrong config' }),
                'Old result leaked after settings change',
              );
              tick(false, 'config2');
              check(
                !document.querySelector('[data-zl-voice-translation]'),
                'Disabled translation kept voice controls',
              );
              return {
                manualOnly: true,
                nativeDecode: true,
                correctMessage: true,
                boundedClicks: true,
                retryReusesTranscript: true,
                staleChatRejected: true,
                staleSettingsRejected: true,
                disabledControlsRemoved: true,
              };
            }.toString()})(${[
              guest.voiceTranslationTick,
              guest.readVoiceTranslationAudio,
              guest.voiceTranslationResult,
              guest.voiceTranslationCurrent,
            ]
              .map(fn => fn.toString())
              .join(',')},${JSON.stringify('__ZL_OGG__')})`,
          );
        } finally {
          win.destroy();
          isolated.protocol.unhandle('https');
        }
      }.toString()})()`.replace('__ZL_OGG__', oggFile),
    )})`,
  );
  assert.equal(proof.nativeDecode, true);
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
}
