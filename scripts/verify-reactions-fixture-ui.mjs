/* eslint-disable no-await-in-loop -- Isolated native desktop fixture setup, verification and cleanup. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import {
  evaluate,
  wait,
  click,
  clickText,
  call,
  socket,
} from './account-tools-cdp.mjs';
import { verifyReactions } from './verify-reactions-ui.mjs';
import { verifyBulkReplies } from './verify-bulk-replies-ui.mjs';
import { verifyBulkReceipts } from './verify-bulk-receipts-ui.mjs';

const fixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
const ids = [];
const service = id =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const guest = (id, code) =>
  evaluate(`${service(id)}.webview.executeJavaScript(${JSON.stringify(code)})`);
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
let sidebar;
let historyBefore;
let historyBackup;
try {
  await wait(
    `!!window.ferdium?.stores?.settings.loaded && !!document.querySelector('.account-tools')`,
    'app ready',
  );
  assert.equal(
    await evaluate(`window.ferdium.stores.services.all.some(s=>s.isEnabled)`),
    false,
    'Only use an isolated QA profile without enabled real accounts',
  );
  sidebar = await evaluate(
    'JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar || {}))',
  );
  await evaluate(
    `require('@electron/remote').getCurrentWindow().setSize(1280,800);window.ferdium.stores.router.push('/')`,
  );
  for (let i = 0; i < 2; i += 1) {
    const before = await evaluate(
      'window.ferdium.stores.services.all.map(s=>s.id)',
    );
    await click('[data-group-id="default"] .account-group__add');
    await wait(
      `window.ferdium.stores.services.createServiceRequest.wasExecuted && !window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && !${JSON.stringify(before)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
      'fixture created',
    );
    const id = await evaluate(
      'window.ferdium.stores.services.createServiceRequest.result.data.id',
    );
    assert(!before.includes(id));
    ids.push(id);
    await wait(
      `window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)})`,
      'fixture model ready',
    );
    await evaluate(`${service(id)}.isHibernationEnabled=false`);
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',()=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
    );
    await wait(`!!${service(id)}.webview`, 'fixture mounted');
    await evaluate(`${service(id)}.webview.reload()`);
    await wait(
      `!${service(id)}.isLoading && ${service(id)}.accountSnapshot.status==='online'`,
      'fixture online',
    );
  }
  const context = {
    first: ids[0],
    second: ids[1],
    guest,
    evaluate,
    wait,
    click,
    clickText,
    call,
    shot: async path => {
      const result = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(result.data, 'base64'));
    },
  };
  if (process.argv.includes('--bulk-replies')) {
    const queueExpression = `require('./features/accountTools/bulkRuntime').getBulkQueue(window.ferdium.stores)`;
    await evaluate(
      `(async()=>{const q=${queueExpression};await q.load();if(q.activeIds.size||q.records.some(r=>r.status==='待发送'))throw Error('Use a QA profile without active or scheduled bulk tasks')})()`,
    );
    historyBefore = await evaluate(
      `require('electron').ipcRenderer.invoke('account-tools-history')`,
    );
    historyBackup = `/tmp/zl-reply-fixture-history-${Date.now()}.json`;
    writeFileSync(historyBackup, JSON.stringify(historyBefore));
    await evaluate(
      `${queueExpression}.remove(${queueExpression}.records.map(r=>r.id))`,
    );
    await verifyBulkReplies(context);
    await verifyBulkReceipts({ ...context, queueExpression });
  } else await verifyReactions(context);
} finally {
  for (const label of ['关闭批量点赞', '关闭回复窗口', '关闭转发窗口'])
    if (await evaluate(`!!document.querySelector('[aria-label="${label}"]')`))
      await click(`[aria-label="${label}"]`);
  if (historyBefore) {
    const queueExpression = `require('./features/accountTools/bulkRuntime').getBulkQueue(window.ferdium.stores)`;
    await evaluate(
      `(async()=>{const q=${queueExpression};if(q.activeIds.size)throw Error('Test queue is still active; history backup retained');const ipc=require('electron').ipcRenderer;await q.remove(q.records.map(r=>r.id));return true})()`,
    );
    for (const record of [...historyBefore].reverse())
      await evaluate(
        `require('electron').ipcRenderer.invoke('account-tools-history',${JSON.stringify(record)})`,
      );
    await evaluate(
      `(async()=>{const q=${queueExpression};q.records=await require('electron').ipcRenderer.invoke('account-tools-history');q.notify();return true})()`,
    );
    rmSync(historyBackup, { force: true });
  }
  for (const id of ids)
    await evaluate(
      `(async()=>{if(window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)}))await window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})})()`,
    );
  if (sidebar)
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${JSON.stringify(sidebar)}}})`,
    );
  socket.close();
}
