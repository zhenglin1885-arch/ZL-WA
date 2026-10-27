/* eslint-disable no-console -- Serialized adapter and real browser audio decoding on an isolated fixture. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const proof = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const file = `${process.cwd()}/build/features/accounts/voice.js`;
        delete req.cache[req.resolve(file)];
        const adapter = req(file).configureWhatsAppVoice;
        const partition = `zl-voice-upload-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><input type="file" accept="audio/*"><button>Send audio</button>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { partition },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          return await win.webContents.executeJavaScript(`(async()=>{
          const configure=${adapter.toString()};
          const calls=[];
          const native={async prepRawMedia(data,options){
            const decoder=new OfflineAudioContext(1,8000,8000);
            const audio=await decoder.decodeAudioData(await data.arrayBuffer());
            const prepared={type:options.isPtt?'ptt':'audio',seconds:audio.duration,name:data.name};
            calls.push(prepared);return prepared;
          }};
          window.require=name=>name==='WAWebPrepRawMedia'?native:undefined;
          if(!configure())throw Error('Native media preparation unavailable');
          const wrapper=native.prepRawMedia;configure();
          if(wrapper!==native.prepRawMedia)throw Error('Adapter installed twice');
          const samples=8000,bytes=new ArrayBuffer(44+samples*2),v=new DataView(bytes);
          const ascii=(offset,text)=>[...text].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
          ascii(0,'RIFF');v.setUint32(4,36+samples*2,true);ascii(8,'WAVE');ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,samples*2,true);
          for(let i=0;i<samples;i++)v.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*440/8000)*12000),true);
          const upload=new File([bytes],'上传语音.wav',{type:'audio/wav'});
          const transfer=new DataTransfer();transfer.items.add(upload);const input=document.querySelector('input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
          let sending;
          document.querySelector('button').onclick=()=>{sending=native.prepRawMedia(input.files[0],{isAudio:true,isPtt:false})};
          document.querySelector('button').click();const voice=await sending;
          if(calls.length!==1||voice.type!=='ptt'||voice.seconds!==1)throw Error('Upload did not prepare one valid PTT');
          const documentResult=await native.prepRawMedia(upload,{asDocument:true});
          if(documentResult.type!=='audio')throw Error('Explicit document upload changed');
          const before=calls.length;
          try{await native.prepRawMedia(new File(['invalid'],'broken.wav',{type:'audio/wav'}),{isAudio:true});throw Error('Invalid audio accepted')}catch(error){if(error.message==='Invalid audio accepted')throw error}
          if(calls.length!==before)throw Error('Failed decode sent or retried audio');
          return {voice,onePreparation:true,explicitDocumentPreserved:true,decodeFailureDidNotSend:true};
        })()`);
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )})`,
  );
  assert.equal(proof.voice.type, 'ptt');
  assert.equal(proof.voice.seconds, 1);
  assert.equal(proof.decodeFailureDidNotSend, true);
  console.log(
    'PASS serialized voice adapter: WAV file upload, native preparation flags, actual Chromium audio decoding, idempotent installation and unchanged document/error handling',
  );
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
}
