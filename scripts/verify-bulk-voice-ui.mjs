/* eslint-disable no-console -- Offline native fixtures with real Chromium decoding, never real WhatsApp sends. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, socket } from './account-tools-cdp.mjs';

const dir = mkdtempSync(join(tmpdir(), 'zl-bulk-wave-'));
try {
  // The left channel is silent. Only decoding all channels finds the signal.
  const ogg = join(dir, 'stereo.ogg');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0|sin(2*PI*440*t)*(0.1+0.8*t/2):s=48000:d=2',
    '-c:a',
    'libopus',
    ogg,
  ]);
  const dataUrl = `data:audio/ogg;base64,${readFileSync(ogg).toString('base64')}`;
  const proof = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run(data) {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const file = `${process.cwd()}/build/features/accountTools/bulkGuest.js`;
        delete req.cache[req.resolve(file)];
        const send = req(file).sendBulkMessage;
        const partition = `zl-bulk-wave-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response('<!doctype html><title>Offline voice test</title>', {
              headers: { 'Content-Type': 'text/html' },
            }),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { partition },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          return await win.webContents.executeJavaScript(`(async()=>{
            const send=${send.toString()},data=${JSON.stringify(data)};
            let outgoing,dispatches=0,precomputed;
            const chat={id:'test@g.us'};
            class Prep {
              async waitForPrep(){return {type:'ptt'}}
              async sendToChat(params){
                if(params.chat!==chat)throw Error('Wrong native ChatModel');
                dispatches++;
                // Final MsgModel fields must come from send options. Merely
                // passing waveform to MediaPrep cannot make this fixture pass.
                outgoing={...params.options.productMsgOptions};
                return {messageSendResult:'OK'};
              }
            }
            window.WPP={isReady:true,chat:{
              get:async()=>chat,
              prepareRawMessage:async(c,props)=>({...props,id:{_serialized:'own-test-message'}}),
              sendFileMessage:()=>{throw Error('Ordinary audio fallback called')},
            },whatsapp:{
              OpaqueData:{createFromData:async blob=>blob},
              functions:{prepRawMedia(blob,options){
                if(!options.isPtt)throw Error('Not PTT');
                precomputed=options.precomputedFields;return new Prep();
              }},
              MsgStore:{get:()=>outgoing},
            }};
            const spec={type:'audio',text:'',targets:[],typingSeconds:0,mentionAll:false,media:{mime:'audio/ogg',name:'test.ogg'}};
            const result=await send('test@g.us',spec,data);
            const wave=[...outgoing.waveform];
            if(!result.confirmed||result.messageId!=='own-test-message'||dispatches!==1||outgoing.type!=='ptt')throw Error('PTT identity or dispatch count changed');
            if(wave.length!==64||new Set(wave).size<8||Math.max(...wave)!==100||outgoing.duration!==2)throw Error('Missing real OGG waveform');
            if(wave.some((v,i)=>v!==precomputed.waveform[i]))throw Error('Final waveform changed');
            const diagnostic={...window.__zlBulkVoice};
            if(diagnostic.storedWaveformMatches!==true||diagnostic.channels!==2)throw Error('Outgoing model not verified');
            let rejected=false;
            try{await send('test@g.us',spec,'data:audio/ogg;base64,YQ==')}catch{rejected=true}
            if(!rejected||dispatches!==1)throw Error('Invalid OGG sent or retried');
            return {codec:'OGG/Opus',diagnostic,waveformDistinctValues:new Set(wave).size,dispatches,invalidAudioDidNotSend:true};
          })()`);
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})(${JSON.stringify(dataUrl)})`,
    )})`,
  );
  assert.equal(proof.diagnostic.storedWaveformMatches, true);
  assert.equal(proof.invalidAudioDidNotSend, true);
  console.log(
    'PASS offline bulk voice: actual OGG/Opus decoding, silent left channel, final PTT waveform, one dispatch, invalid audio rejected',
  );
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
  rmSync(dir, { recursive: true, force: true });
}
