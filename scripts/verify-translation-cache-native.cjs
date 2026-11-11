module.exports = async function verifyTranslationCache(base) {
  const req = process
    .getBuiltinModule('module')
    .createRequire(process.execPath);
  const { BrowserWindow, session } = req('electron');
  const guest = req(`${base}/features/accountTools/guest.js`);
  const partition = `zl-cache-presentation-${Date.now()}`;
  const isolated = session.fromPartition(partition);
  await isolated.protocol.handle(
    'https',
    () =>
      new Response(
        '<!doctype html><meta charset="utf-8"><div id="main"><header><span title="Chat A">Chat A</span></header><div id="messages"></div></div>',
        { headers: { 'Content-Type': 'text/html' } },
      ),
  );
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition, backgroundThrottling: false },
  });
  try {
    await win.loadURL('https://web.whatsapp.com/');
    return await win.webContents.executeJavaScript(`(async()=>{
      const tick=${guest.translationTick.toString()},result=${guest.translationResult.toString()},query=${guest.translationCacheRequests.toString()},restore=${guest.restoreTranslationCache.toString()};
      const config={incoming:true,outgoing:false,preview:false,receiveEngine:'Google',receiveSource:'pt',receiveTarget:'zh-CN'};
      const assert=(condition,message)=>{if(!condition)throw Error(message)};
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const body=(text)=>'<div class="message-in"><div class="copyable-text" data-pre-plain-text="text"><span class="selectable-text">'+text+'</span></div></div>';
      const messages=document.querySelector('#messages'),header=document.querySelector('header span');
      messages.innerHTML=body('Bom dia');tick(config);
      const batch=query();assert(batch.items.length===1,'Discover cold cache without provider jobs');
      assert(window.__zlTranslation.queue.length===0,'Cache lookup submitted a provider job');
      assert(!restore({...batch,token:'old'},[{key:batch.items[0].key,text:'Wrong'}]),'Old document restored');
      assert(!restore({...batch,signature:'old'},[{key:batch.items[0].key,text:'Wrong'}]),'Old language restored');
      assert(restore(batch,[{key:batch.items[0].key,text:'早安'}]),'Restore cold cache');
      assert(document.querySelector('[data-zl-translation-text]').textContent==='早安','Cold cached text missing');
      assert(query().items.length===0,'Repeated cold query');
      header.title='Chat B';messages.innerHTML=body('Mensagem sem cache');await Promise.resolve();window.__zlTranslation.settleUntil=Date.now()+60000;await frame();
      assert(window.__zlTranslation.settleUntil>Date.now(),'Must test inside chat settling interval');
      assert(document.querySelector('[data-zl-translate]'),'Button did not appear before host poll');
      const other=query();restore(other,[]);
      header.title='Chat A';messages.innerHTML=body('Bom dia');await Promise.resolve();window.__zlTranslation.settleUntil=Date.now()+60000;await frame();
      assert(window.__zlTranslation.settleUntil>Date.now(),'Warm test missed settling interval');
      assert(document.querySelector('[data-zl-translation-text]').textContent==='早安','Warm cache not restored without host tick');
      assert(window.__zlTranslation.queue.length===0,'Warm restore queued translation');
      document.querySelector('[data-zl-retranslate]').click();
      const jobs=tick(config);assert(jobs.length===1&&jobs[0].force,'Manual refresh must remain available');
      restore(batch,[{key:batch.items[0].key,text:'Stale cache'}]);
      assert(document.querySelector('[data-zl-translation-text]').textContent!=='Stale cache','Cache overwrote pending refresh');
      result(jobs[0].id,jobs[0].token,{text:'重新翻译',error:false});
      header.title='Chat C';messages.innerHTML=body('Outro texto');await frame();
      config.preview=true;tick(config);query();
      window.__zlTranslation.previewBlockedChat=undefined;
      window.__zlTranslation.settleUntil=Date.now()-1;
      window.__zlTranslation.dirty=true;
      assert(tick(config).length===0,'Automatic request ran before persistent cache lookup');
      const auto=query();restore(auto,[]);window.__zlTranslation.dirty=true;
      assert(tick(config).length===1,'Cache miss blocked normal automatic translation');
      return {warmCacheBeforeHostPoll:true,buttonsBeforeHostPoll:true,coldCacheWithoutProvider:true,staleResultsRejected:true,manualRefreshPreserved:true,automaticCacheMissPreserved:true};
    })()`);
  } finally {
    win.destroy();
    isolated.protocol.unhandle('https');
  }
};
