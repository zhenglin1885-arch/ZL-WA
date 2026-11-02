/* eslint-disable no-console, no-await-in-loop -- Synthetic native Chromium conversation and layout fixture. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const fs = req('node:fs');
        const { BrowserWindow, session } = req('electron');
        for (const file of [
          'conversations/guest',
          'customers/guest',
          'accounts/layout',
        ])
          delete req.cache[
            req.resolve(`${process.cwd()}/build/features/${file}.js`)
          ];
        const guest = req(
          `${process.cwd()}/build/features/conversations/guest.js`,
        );
        const customer = req(
          `${process.cwd()}/build/features/customers/guest.js`,
        );
        const layout = req(
          `${process.cwd()}/build/features/accounts/layout.js`,
        );
        const s = session.fromPartition(`zl-aggregate-guest-${Date.now()}`);
        let html = fs.readFileSync(
          `${process.cwd()}/scripts/fixtures/whatsapp-tools.html`,
          'utf8',
        );
        await s.protocol.handle(
          'https',
          () =>
            new Response(html, { headers: { 'content-type': 'text/html' } }),
        );
        const win = new BrowserWindow({
          show: false,
          width: 1200,
          height: 850,
          webPreferences: { session: s },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          const index = await win.webContents.executeJavaScript(`(async()=>{
    const read=${customer.readCustomerContext.toString()},index=${guest.readConversationIndex.toString()},avatars=${guest.readConversationAvatars.toString()};
    const models=window.require('WAWebCollections').Chat.getModelsArray();
    models[0].lastMessage={id:{fromMe:false},body:'recent incoming',t:1700000000};models[0].unreadCount=7;models[0].archive=true;
    window.require('WAWebCollections').Contact={getModelsArray:()=>[{id:{_serialized:'50005@c.us'},name:'Saved contact',isMyContact:true}]};
    models[0].formattedTitle='Native group name';
    models[1].contact={id:models[1].id,isMyContact:false,pushname:'Unstored nickname',name:'Unstored business name'};
    const context=read(),result=index();
    if(result.rows.find(row=>row.id==='10002@c.us')?.name!=='10002')throw Error('Unsaved contact title is not the phone number');
    if(result.rows.find(row=>row.id==='10001@g.us')?.name!=='Native group name')throw Error('Native group title was replaced');
    models[1].contact.isMyContact=()=>true;models[1].contact.name='Native saved name';
    if(index().rows.find(row=>row.id==='10002@c.us')?.name!=='Native saved name')throw Error('Saved native contact name was lost');
    models.push({id:{_serialized:'90001@lid'},name:'Unstored LID name',contact:{id:{_serialized:'90001@lid'},phoneNumber:{_serialized:'551234567@c.us'},isMyContact:false,pushname:'Not the phone'}});
    if(index().rows.find(row=>row.id==='90001@lid')?.name!=='551234567')throw Error('Unsaved LID title did not use its phone alias');
    if(!result.contactsReady||!result.rows.some(row=>row.id==='50005@c.us'&&row.contactOnly)||!result.rows.some(row=>row.archived&&row.unread===7&&row.lastFromMe===false&&row.preview==='recent incoming'))throw Error('Native conversation index fields missing');
    const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;canvas.getContext('2d').fillRect(0,0,8,8);
    window.require('WAWebCollections').ProfilePicThumb={get:()=>({img:canvas.toDataURL()})};
    const images=await avatars([result.rows[0].id],context.owners);if(!images[result.rows[0].id]?.startsWith('data:image/jpeg;base64,'))throw Error('Visible avatar did not use account-local conversion');
    if(Object.keys(await avatars([result.rows[0].id],['999999999@c.us'])).length)throw Error('Wrong owner read profile picture');
    window.require('WAWebSocketModel').Socket.state='UNPAIRED';read();if(index().rows.length)throw Error('Logged-out account retained accessible index');
    if(fixture.bulk.length)throw Error('Indexing submitted a message');
    return {nativeTitlesAndUnsavedNumbers:true,nativeChatsAndSavedContacts:true,archivedUnreadAndDirection:true,accountLocalAvatars:true,ownerIsolation:true,noMessagesSent:true};
   })().catch(error=>({error:String(error.stack||error)}))`);
          if (index.error) throw new Error(index.error);
          const modes = [];
          for (const kind of ['flex', 'grid']) {
            html = `<!doctype html><style>html,body,#app{height:100%;margin:0}#split{display:${kind};height:700px;width:1000px;${kind === 'grid' ? 'grid-template-columns:60px 280px minmax(0,1fr)' : ''}}#side{width:280px;flex:0 0 280px;height:700px}#main{flex:1;height:700px;min-width:0}</style><div id="app"><div id="split">${kind === 'grid' ? '<div style="width:60px;height:700px">rail</div>' : ''}<div id="side"><header>chat list</header><div id="pane-side"></div></div><div id="main"><header>conversation</header></div></div></div>`;
            await win.loadURL('https://web.whatsapp.com/');
            const proof = await win.webContents.executeJavaScript(
              `(()=>{try{const configure=${layout.configureWhatsAppLayout.toString()},mode=${guest.setAggregateChatMode.toString()};configure();const before=document.querySelector('#main').getBoundingClientRect();if(!mode(true))throw Error('Aggregate mode was not ready');configure();const during=document.querySelector('#main').getBoundingClientRect();if(document.querySelector('#side').getBoundingClientRect().width!==0||during.width<before.width+250)throw Error('Native list was not hidden or pane did not expand '+JSON.stringify({before:before.width,during:during.width,side:document.querySelector('#side').getBoundingClientRect().width,html:document.querySelector('#split').outerHTML}));mode(false);configure();const after=document.querySelector('#main').getBoundingClientRect();if(Math.abs(after.width-before.width)>1)throw Error('Original native width was not restored');return {before:before.width,during:during.width,after:after.width};}catch(error){return {error:String(error.stack||error)};}})()`,
            );
            if (proof.error) throw new Error(`${kind}: ${proof.error}`);
            modes.push({ kind, ...proof });
          }
          return { index, modes };
        } finally {
          win.destroy();
          await s.protocol.unhandle('https');
        }
      }.toString()})()`,
    )})`,
  );
  console.log(JSON.stringify(result));
  assert(result.index.noMessagesSent);
} finally {
  socket.close();
}
