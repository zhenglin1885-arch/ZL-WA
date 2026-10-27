/* eslint-disable no-console, no-await-in-loop -- Sequential isolated downloads through the real service preload and IPC. */
import assert from 'node:assert/strict';

export async function verifyServiceDownloads({
  first,
  second,
  guest,
  evaluate,
  wait,
}) {
  const vm = code =>
    evaluate(
      `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
    );
  const before = await evaluate(
    'JSON.parse(JSON.stringify(window.ferdium.stores.app.downloads))',
  );
  const ids = [];
  for (const account of [first, second])
    ids.push(
      await evaluate(
        `window.ferdium.stores.services.all.find(s=>s.id===${JSON.stringify(account)}).webview.getWebContentsId()`,
      ),
    );
  await vm(`(()=>{
    const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
    const {webContents}=req('electron'),fs=req('node:fs'),path=req('node:path'),os=req('node:os');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'zl-service-downloads-'));
    const state={root,records:[],listeners:[]};globalThis.__zlServiceDownloadProof=state;
    for(const id of ${JSON.stringify(ids)}){
      const wc=webContents.fromId(id);
      const listener=(event,item,source)=>{
        if(source?.id!==id)return;
        const target=path.join(root,id+'-'+state.records.length+'-'+path.basename(item.getFilename()));
        const record={id,prevented:event.defaultPrevented,state:'pending'};state.records.push(record);item.setSavePath(target);
        item.once('done',(_event,status)=>{record.state=status;record.text=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null});
      };
      wc.session.on('will-download',listener);state.listeners.push({session:wc.session,listener});
    }return true;
  })()`);
  let completed = 0;
  try {
    for (const [index, account] of [first, second].entries()) {
      assert.equal(
        await guest(account, 'typeof window.showSaveFilePicker'),
        'undefined',
        'unsupported save picker must be disabled before page feature detection',
      );
      assert.equal(
        await guest(account, "'showSaveFilePicker' in window"),
        false,
        'presence-based native download checks must also use the fallback',
      );
      assert.equal(
        await guest(account, 'typeof window.showOpenFilePicker'),
        'function',
        'upload picker remains available',
      );
      for (const mime of ['audio/ogg', 'image/png', 'application/pdf']) {
        for (const mode of [
          'anchor',
          'popup',
          'named',
          'delayed-href',
          'delayed-location',
        ]) {
          const text = `account-${index}/${mime}/${mode}`;
          await guest(
            account,
            `(()=>{const url=URL.createObjectURL(new Blob([${JSON.stringify(text)}],{type:${JSON.stringify(mime)}}));const mode=${JSON.stringify(mode)};
            if(mode==='anchor'){const a=document.createElement('a');a.href=url;a.download='media.bin';document.body.append(a);a.click();a.remove()}
            else if(mode==='popup')window.open(url);
            else if(mode==='named')window.open(url,'_blank');
            else {const p=window.open();p.document.body.textContent='Preparing media';if(mode==='delayed-href')p.location.href=url;else p.location=url}
            return true})()`,
          );
          completed += 1;
          await wait(
            `require('@electron/remote').require('node:vm').runInThisContext('globalThis.__zlServiceDownloadProof.records.filter(r=>r.state==="completed").length')===${completed}`,
            `${mime}/${mode} saved`,
          );
          const record = await vm(
            `globalThis.__zlServiceDownloadProof.records.at(-1)`,
          );
          assert.equal(record.text, text, 'saved bytes match selected media');
          assert.equal(
            record.id,
            ids[index],
            'download uses its originating account',
          );
          assert.equal(record.prevented, false);
        }
      }
    }
    console.log(
      'PASS real service downloads: voice/image/document, direct anchors, unnamed/named popups, delayed mutable popup locations, main-frame IPC, original account ownership and exact saved bytes; standard fallback detected before site scripts',
    );
  } finally {
    await vm(
      `(()=>{const s=globalThis.__zlServiceDownloadProof;if(s){for(const l of s.listeners)l.session.removeListener('will-download',l.listener);process.getBuiltinModule('fs').rmSync(s.root,{recursive:true,force:true});delete globalThis.__zlServiceDownloadProof}return true})()`,
    );
    await evaluate(
      `require('mobx').runInAction(()=>{window.ferdium.stores.app.downloads=${JSON.stringify(before)}})`,
    );
  }
}
