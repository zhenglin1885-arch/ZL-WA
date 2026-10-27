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
        const diagnosticsFile = `${process.cwd()}/build/features/accountTools/guest.js`;
        delete req.cache[req.resolve(diagnosticsFile)];
        const diagnostics = req(diagnosticsFile).translationDiagnostics;
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
          const configure=${adapter.toString()},diagnostics=${diagnostics.toString()};
          const calls=[];
          class NativePrep {
            constructor(media){this._mediaData=media}
            async waitForPrep(){return this._mediaData}
            async sendToChat(params){
              const m=this._mediaData,o=params.options||{};
              const message={type:o.productMsgOptions?.type||o.type||m.type,seconds:m.duration,waveform:m.waveform?[...m.waveform]:[],quote:o.quotedMsg,id:o.productMsgOptions?.id};
              calls.push(message);return message;
            }
          }
          const native=Object.freeze({prepRawMedia(data,options){return new NativePrep({type:options.isAudio?'audio':options.isPtt?'ptt':'audio',mediaBlob:data,...options.precomputedFields,set(fields){Object.assign(this,fields)}})}});
          let loaded=false;window.require=name=>!loaded?undefined:name==='WAWebPrepRawMedia'?native:name==='WAWebMediaPrep'?Object.freeze({MediaPrep:NativePrep}):undefined;
          if(configure())throw Error('Unavailable native modules must not report ready');
          loaded=true;
          const samples=8000,bytes=new ArrayBuffer(44+samples*2),v=new DataView(bytes);
          const ascii=(offset,text)=>[...text].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
          ascii(0,'RIFF');v.setUint32(4,36+samples*2,true);ascii(8,'WAVE');ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,samples*2,true);
          for(let i=0;i<samples;i++)v.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*440/8000)*12000*(0.1+0.9*i/samples)),true);
          const upload=new File([bytes],'上传语音.wav',{type:'audio/wav'});
          const transfer=new DataTransfer();transfer.items.add(upload);const input=document.querySelector('input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
          const options=Object.freeze({type:'audio',quotedMsg:'quoted-target',productMsgOptions:Object.freeze({type:'audio',id:'same-message-id'})});
          const dispatch=async(file,opts=options)=>native.prepRawMedia(file,{isAudio:true,isPtt:false}).sendToChat({chat:{id:'group@g.us'},options:opts});
          let sending;
          document.querySelector('button').onclick=()=>{sending=dispatch(input.files[0])};
          document.querySelector('button').click();const voice=await sending;
          if(calls.length!==1||voice.type!=='ptt'||voice.seconds!==1||voice.waveform.length!==64||new Set(voice.waveform).size<4||Math.max(...voice.waveform)!==100)throw Error('Final message is not PTT with a real 64-sample waveform: '+JSON.stringify(voice));
          const wrapper=NativePrep.prototype.sendToChat;configure();if(wrapper!==NativePrep.prototype.sendToChat||wrapper.length!==1)throw Error('Stacked wrapper or changed native signature');
          if(voice.quote!=='quoted-target'||voice.id!=='same-message-id'||options.type!=='audio')throw Error('Quote, message identity or original options changed');
          const documentResult=await dispatch(upload,{type:'document'});
          if(documentResult.type!=='document')throw Error('Explicit document upload changed');
          const before=calls.length;
          try{await dispatch(new File(['invalid'],'broken.wav',{type:'audio/wav'}));throw Error('Invalid audio accepted')}catch(error){if(error.message==='Invalid audio accepted')throw error}
          if(calls.length!==before)throw Error('Failed decode sent or retried audio');
          window.__zlVoiceMessages.last.error='PRIVATE_AUDIO_CONTENT_7';const diagnostic=diagnostics();if(JSON.stringify(diagnostic).includes('PRIVATE_AUDIO_CONTENT_7')||diagnostic.voice.last.failed!==true)throw Error('Voice diagnostics leaked raw error details');
          return {voice,oneDispatch:true,explicitDocumentPreserved:true,decodeFailureDidNotSend:true,diagnostic:diagnostic.voice.last};
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
    'PASS serialized final-send voice adapter: immutable native export fixture, actual WAV decoding, real 64-sample waveform, explicit audio overrides replaced with PTT, single dispatch and preserved quotes/document/error handling',
  );
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
}
