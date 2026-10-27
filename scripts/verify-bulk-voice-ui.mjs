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
        const audioFile = `${process.cwd()}/build/features/accounts/audioUpload.js`;
        delete req.cache[req.resolve(audioFile)];
        const configureAudio = req(audioFile).configureWhatsAppAudioUpload;
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
            const send=${send.toString()},configureAudio=${configureAudio.toString()},data=${JSON.stringify(data)};
            let outgoing,dispatches=0,precomputed;
            const chat={id:'123@g.us',formattedTitle:'Test recipient',set(fields){Object.assign(this,fields)}};
            let active=chat,owner='123@c.us';
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
            window.WPP={isReady:true,conn:{getMyUserWid:()=>owner},chat:{
              getActiveChat:()=>active,
              getMessageById:async()=>({id:{_serialized:'quote',remote:'123@g.us'}}),
              get:async()=>chat,
              prepareRawMessage:async(c,props,options)=>({...props,quotedMsg:options.quotedMsg,id:{_serialized:'own-test-message'}}),
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
            const result=await send('123@g.us',spec,data);
            const wave=[...outgoing.waveform];
            if(!result.confirmed||result.messageId!=='own-test-message'||dispatches!==1||outgoing.type!=='ptt')throw Error('PTT identity or dispatch count changed');
            if(wave.length!==64||new Set(wave).size<8||Math.max(...wave)!==100||outgoing.duration!==2)throw Error('Missing real OGG waveform');
            if(wave.some((v,i)=>v!==precomputed.waveform[i]))throw Error('Final waveform changed');
            const diagnostic={...window.__zlBulkVoice};
            if(diagnostic.storedWaveformMatches!==true||diagnostic.channels!==2)throw Error('Outgoing model not verified');
            let rejected=false;
            try{await send('123@g.us',spec,'data:audio/ogg;base64,YQ==')}catch{rejected=true}
            if(!rejected||dispatches!==1)throw Error('Invalid OGG sent or retried');

            configureAudio(send);configureAudio(send);
            const input=document.createElement('input');input.type='file';input.accept='audio/*';document.body.append(input);
            const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.codePointAt(0));
            const upload=new File([bytes],'sample.ogg',{type:'audio/ogg'});
            let nativeChanges=0;document.addEventListener('change',()=>nativeChanges++);
            const select=()=>{const transfer=new DataTransfer();transfer.items.add(upload);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}))};
            const button=selector=>document.querySelector(selector);
            const close=()=>button('[data-zl-audio-cancel]').click();
            const waitDone=async()=>{const until=Date.now()+5000;while(window.__zlAudioUpload.last==='sending'&&Date.now()<until)await new Promise(r=>setTimeout(r,20));if(window.__zlAudioUpload.last==='sending')throw Error('Audio send did not settle')};
            select();
            if(dispatches!==1||!button('[data-zl-audio-upload] audio')||nativeChanges!==0)throw Error('Audio must preview before sending, without native ordinary audio');
            close();if(dispatches!==1)throw Error('Cancel dispatched audio');
            chat.composeQuotedMsg={id:{_serialized:'quote'}};
            select();button('[data-zl-audio-send]').click();button('[data-zl-audio-send]').click();await waitDone();
            if(window.__zlAudioUpload.last!=='submitted'||dispatches!==2||outgoing.type!=='ptt'||outgoing.waveform.length!==64||outgoing.quotedMsg!=='quote')throw Error('Audio UI did not use the shared quoted PTT waveform route');
            if(chat.composeQuotedMsg!==null)throw Error('Confirmed composer reply not cleared');
            close();
            select();active={id:'456@g.us'};button('[data-zl-audio-send]').click();await waitDone();
            if(dispatches!==2||window.__zlAudioUpload.last!=='failed')throw Error('Changed conversation received audio');close();active=chat;
            select();owner='456@c.us';button('[data-zl-audio-send]').click();await waitDone();
            if(dispatches!==2||window.__zlAudioUpload.last!=='failed')throw Error('Changed account received audio');close();owner='123@c.us';
            input.accept='*/*';select();if(nativeChanges!==1||button('[data-zl-audio-upload]'))throw Error('Document picker intercepted');
            input.accept='audio/*';window.WPP.isReady=false;select();
            if(button('[data-zl-audio-send]')||dispatches!==2||nativeChanges!==1)throw Error('Unready library fell back to ordinary audio');close();
            return {codec:'OGG/Opus',diagnostic,waveformDistinctValues:new Set(wave).size,dispatches,invalidAudioDidNotSend:true,audioUI:{preview:true,cancel:true,quote:true,singleDispatch:true,changedChatBlocked:true,changedAccountBlocked:true,documentsPreserved:true,unreadyDidNotSend:true}};

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
