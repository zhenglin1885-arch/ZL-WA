/* eslint-disable no-console -- Native Chromium decoding of compressed and resized images plus actual serialized guest execution. */
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
        const helperPath = `${process.cwd()}/build/features/reactions/image.js`;
        const guestPath = `${process.cwd()}/build/features/reactions/guest.js`;
        delete req.cache[req.resolve(helperPath)];
        delete req.cache[req.resolve(guestPath)];
        const helper = req(helperPath).prepareReactionImage;
        const guest = req(guestPath).reactionGuest;
        const isolated = session.fromPartition(`reaction-pixels-${Date.now()}`);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response('<!doctype html><body>Image matching fixture</body>', {
              headers: { 'Content-Type': 'text/html' },
            }),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { session: isolated },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          await win.webContents.executeJavaScript(
            `window.makeImage=${helper.toString()};window.runGuest=${guest.toString()};true`,
          );
          return await win.webContents.executeJavaScript(`(async()=>{
        const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;
        const context=canvas.getContext('2d');
        const gradient=context.createLinearGradient(0,0,480,320);gradient.addColorStop(0,'#16256f');gradient.addColorStop(1,'#8adeaa');
        context.fillStyle=gradient;context.fillRect(0,0,480,320);context.fillStyle='#ff9a30';context.fillRect(50,40,170,160);context.fillStyle='white';context.font='30px sans-serif';context.fillText('IMAGE MATCH 123',80,260);
        const reference=canvas.toDataURL('image/png');
        const small=document.createElement('canvas');small.width=240;small.height=160;small.getContext('2d').drawImage(canvas,0,0,240,160);
        const compressed=small.toDataURL('image/jpeg',0.55);
        context.fillStyle='#c41257';context.fillRect(0,0,480,320);
        const different=canvas.toDataURL('image/png');
        const blob=async url=>(await fetch(url)).blob();
        const picture={...await makeImage(await blob(reference)),name:'reference.png'};
        const resized=await makeImage(await blob(compressed),picture);
        const rejected=await makeImage(await blob(different),picture);
        const ownerId='8613800000001@c.us',groupId='10001@g.us';
        const images={old:reference,latest:compressed,different};
        const rows=Object.keys(images).map((key,i)=>({id:'false_'+groupId+'_'+key,type:'image',body:'unrelated caption',filehash:key,t:i+1}));
        const calls=[];
        window.WPP={isReady:true,conn:{getMyUserWid:()=>ownerId},group:{iAmMember:async()=>true},chat:{
          getMessages:async()=>rows,
          getMessageById:async id=>rows.find(m=>m.id===id),
          downloadMedia:async id=>blob(images[id.split('_').at(-1)]),
          sendReactionToMessage:async(id,emoji)=>{calls.push({id,emoji});return{}},
          getReactions:async id=>({reactionByMe:calls.some(c=>c.id===id)?{reactionText:'👍',senderUserJid:ownerId}:undefined})
        }};
        const rules={content:'image',picture,text:'',match:'exact'};
        const found=await runGuest({ownerId,groupId,rules},makeImage);
        const before=calls.length;
        const sent=await runGuest({ownerId,groupId,rules,messageId:found.messageId,expectedImageHash:found.imageHash,emoji:'👍',token:'image-1'},makeImage);
        rows.find(m=>m.id===found.messageId).filehash='changed';
        const changed=await runGuest({ownerId,groupId,rules,messageId:found.messageId,expectedImageHash:found.imageHash,emoji:'👍',token:'image-2'},makeImage);
        return {resized:resized.matches,different:rejected.matches,found:found.messageId,hasPreview:found.imagePreview.startsWith('data:image/jpeg;'),before,sent:sent.status,changed:changed.status,calls:calls.length};
      })()`);
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )} )`,
  );
  assert.deepEqual(proof, {
    resized: true,
    different: false,
    found: 'false_10001@g.us_latest',
    hasPreview: true,
    before: 0,
    sent: 'success',
    changed: 'failed',
    calls: 1,
  });
  console.log(
    'PASS native image decoding: compressed/resized match, different image rejected, newest image preview, no search mutation, single reaction, changed-media protection',
  );
} finally {
  socket.close();
}
