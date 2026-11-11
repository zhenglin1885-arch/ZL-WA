/* eslint-disable no-console, unicorn/consistent-function-scoping -- Serialized native Electron verification using an isolated offline page. */
module.exports = async function verifyMessageTranslation(base) {
  const req = process
    .getBuiltinModule('module')
    .createRequire(process.execPath);
  const { BrowserWindow, session } = req('electron');
  const guest = req(`${base}/features/accountTools/guest.js`);
  const partition = `zl-message-compatibility-${Date.now()}`;
  const isolated = session.fromPartition(partition);
  const html = `<!doctype html><meta charset="utf-8"><div id="main">
    <div role="row"><div data-pre-plain-text="text"><span class="selectable-text">Ordinary row message</span></div></div>
    <div data-testid="msg-container"><div data-pre-plain-text="text"><span dir="auto">Ordinary container message</span></div></div>
    <div data-id="modern-message-id"><span class="selectable-text">Ordinary new identity message</span></div>
    <div role="row"><section data-testid="group-info-card"><span class="selectable-text">Group information card</span></section></div>
    <div class="message-in" data-id="false_10001@g.us_card"><div data-testid="contact-card"><span class="selectable-text">Contact card name</span></div></div>
  </div>`;
  await isolated.protocol.handle(
    'https',
    () =>
      new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  const win = new BrowserWindow({ show: false, webPreferences: { partition } });
  try {
    await win.loadURL('https://web.whatsapp.com/');
    return await win.webContents.executeJavaScript(`(()=>{
      const tick=${guest.translationTick.toString()},result=${guest.translationResult.toString()};
      const config={incoming:true,outgoing:false,preview:false,receiveEngine:'Google',receiveSource:'auto',receiveTarget:'zh-CN'};
      tick(config);
      const controls=[...document.querySelectorAll('[data-zl-translate]')];
      if(controls.length!==3)throw Error('Normal message translation controls were lost or a card received a control');
      controls.forEach(control=>control.click());
      const jobs=tick(config);
      if(jobs.length!==3||jobs.some(job=>!job.text.startsWith('Ordinary ')))throw Error('Normal message requests were lost or contained card text');
      jobs.forEach(job=>result(job.id,job.token,{text:'Verified translation',error:false}));
      const labels=[...document.querySelectorAll('[data-zl-translation-text]')];
      if(labels.length!==3||labels.some(label=>label.textContent!=='Verified translation'))throw Error('Normal message translation was not rendered');
      return {normalMessagesTranslated:3,nonMessageCardsExcluded:2};
    })()`);
  } finally {
    win.destroy();
    await isolated.protocol.unhandle('https');
  }
};
