/* eslint-disable no-console -- GUI regression output. */
import assert from 'node:assert/strict';

export async function verifyCustomerCompatibility({
  first,
  service,
  guest,
  wait,
}) {
  await guest(
    first,
    `(()=>{
    fixture.compatRequire=window.require;fixture.compatWPP=window.WPP;
    const native=fixture.compatRequire('WAWebCollections').Chat;
    const models=[...native.getModelsArray(),...Array.from({length:10000},(_,i)=>({id:{_serialized:(200000+i)+'@c.us'},name:'Repeated contact name'}))];
    const keyed=Object.fromEntries(models.map((m,i)=>[i,m]));
    window.require=name=>{
      if(name==='WAWebCollections')return {...fixture.compatRequire(name),Chat:undefined};
      if(name==='WAWebChatCollection')return {ChatCollection:{models:keyed}};
      if(name==='WAWebUserPrefsMeUser')return {getMaybeMePnUser:()=>({_serialized:fixture.ownPhone+':7@c.us'}),getMaybeMeLidUser:()=>{throw Error('LID still synchronizing')}};
      return fixture.compatRequire(name);
    };
    window.WPP={isReady:true,conn:{getMyUserId:()=>({_serialized:fixture.ownPhone+'@c.us'})},whatsapp:{ChatStore:native}};
    document.querySelectorAll('#pane-side [data-zl-customers]:not(style)').forEach(n=>n.remove());
    document.querySelectorAll('#pane-side [data-zl-customer-rendered]').forEach(n=>delete n.dataset.zlCustomerRendered);
    window.__zlCustomers.dirty=true;
    return true;
  })()`,
  );
  try {
    await wait(
      `${service(first)}.webview.executeJavaScript(${JSON.stringify('!!document.querySelector(\'[data-id="10002@c.us"] .zl-chat-note\')')})`,
      'new-login adapter restores inline notes with 10000 extra contacts',
    );
    await guest(
      first,
      `(()=>{const input=document.querySelector('[data-id="10002@c.us"] .zl-chat-note');input.focus();input.value='新登录兼容备注';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return true})()`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript(${JSON.stringify('document.querySelector(\'[data-id="10002@c.us"] .zl-chat-note\')?.dataset.saveState==="saved"')})`,
      'new-login inline note saves',
    );
    await wait(
      'document.querySelector("#customer-remark-name")?.value==="新登录兼容备注"',
      'customer panel remains synchronized',
    );
    await guest(first, `fixture.nativePinCommand('10005@c.us').then(()=>true)`);
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelectorAll("#pane-side [data-icon=pinned]").length===5')`,
      'new-login owner guard permits local pins beyond three',
    );
    assert.equal(
      await guest(first, 'fixture.nativePinServerCalls || 0'),
      0,
      'no server pin calls',
    );
    assert.equal(
      await guest(first, 'window.__zlCustomers.models.length'),
      10_007,
      'full collection supported without a contact-count cutoff',
    );
    console.log(
      'PASS new-login LID getter failure, device-qualified owner, keyed alternate collection, 10000 extra contacts, inline note save, client panel sync and more than three local pins',
    );
  } finally {
    await guest(
      first,
      `window.require=fixture.compatRequire;window.WPP=fixture.compatWPP;delete fixture.compatRequire;delete fixture.compatWPP;window.__zlCustomers.dirty=true;true`,
    );
  }
}
