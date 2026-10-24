/* eslint-disable no-console -- GUI regression results. */
import assert from 'node:assert/strict';
import { evaluate, wait, socket } from './account-tools-cdp.mjs';

try {
  await evaluate(`(()=>{
    const React=require('react');
    const BackupPage=require('./features/chatBackup/ChatBackupPage').default;
    const accounts=[{id:'qa-a',name:'QA A',recipe:{id:'whatsapp'},isEnabled:true,accountSnapshot:{status:'online',nickname:'QA A',phone:'111'}},{id:'qa-b',name:'QA B',recipe:{id:'whatsapp'},isEnabled:true,accountSnapshot:{status:'online',nickname:'QA B',phone:'222'}},{id:'qa-sleep',recipe:{id:'whatsapp'},isEnabled:true,isHibernating:true,accountSnapshot:{status:'online'}}];
    const host=document.createElement('div');host.id='qa-backup-options';host.style.cssText='position:fixed;inset:0;z-index:1000;overflow:auto;background:#222';document.body.append(host);
    const root=require('react-dom/client').createRoot(host);window.__qaBackupOptions={root,host};
    root.render(React.createElement(BackupPage,{stores:{services:{all:accounts}}}));return true;
  })()`);
  await wait(
    `!!document.querySelector('#qa-backup-options select[aria-label="备份同步账号"]')`,
    'backup page',
  );
  const options = await evaluate(
    `[...document.querySelector('#qa-backup-options select[aria-label="备份同步账号"]').options].map(o=>({value:o.value,text:o.text,disabled:o.disabled}))`,
  );
  assert(
    options.some(
      o => o.value === 'all' && !o.disabled && o.text.includes('全部在线'),
    ),
  );
  assert.deepEqual(
    options.filter(o => o.value.startsWith('qa-')).map(o => o.value),
    ['qa-a', 'qa-b'],
  );
  const text = await evaluate(
    `document.querySelector('#qa-backup-options').textContent`,
  );
  assert(text.includes('图片嵌入对话'));
  assert(text.includes('每个日期文件夹包含截至该日期的全部已保存历史'));
  assert(text.includes('补导出最近一次完整记录'));
  assert(!text.includes('图片文件夹'));
  await evaluate(
    `(()=>{const select=document.querySelector('#qa-backup-options select[aria-label="备份同步账号"]');select.value='all';select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`,
  );
  await wait(
    `document.querySelector('#qa-backup-options select[aria-label="备份同步账号"]').value==='all'`,
    'all accounts selected',
  );
  console.log(
    'PASS backup all-online selection, sleeping-account exclusion and embedded-image export instructions',
  );
} finally {
  await evaluate(
    `(()=>{window.__qaBackupOptions?.root.unmount();window.__qaBackupOptions?.host.remove();delete window.__qaBackupOptions;return true})()`,
  );
  socket.close();
}
