/* eslint-disable no-console -- Standalone UI regression output. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { evaluate, wait, clickText, socket } from './account-tools-cdp.mjs';

const source = `
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import BulkHistory from './src/features/accountTools/BulkHistory';
import BulkQueue from './src/features/accountTools/BulkQueue';
const targets=Array.from({length:5},(_,i)=>({id:(10001+i)+'@g.us',accountId:'fixture-account',name:'测试群'+(i+1),group:true}));
const spec={type:'text',text:'原始错误内容',targets,intervalMin:.5,intervalMax:.5,typingSeconds:0,mentionAll:false,failure:'continue'};
const fixture={saves:[],edited:[],revoked:[],sent:0,allowAll:false};
const queue=new BulkQueue({load:async()=>[],save:async record=>{fixture.saves.push(structuredClone(record))},remove:async()=>[],send:async()=>{fixture.sent++;throw Error('Must never resend')},revoke:async(target,id)=>{fixture.revoked.push({target,id})},reconcile:async(target)=>({messageId:'recovered-'+target.id,confirmed:true}),edit:async(target,id,text)=>{if(!fixture.allowAll&&target.id==='10005@g.us')throw Error('已超出15分钟时限');fixture.edited.push({target,id,text})}});
queue.records=[{id:'false-failure',started:new Date().toISOString(),ended:new Date().toISOString(),text:spec.text,status:'部分失败',total:5,success:0,failed:5,details:[],spec,deliveries:targets.map(target=>({target,status:'failed'}))}];
const box=document.createElement('div');box.className='account-tools-dialog';box.style.cssText='position:fixed;inset:12px;overflow:auto;z-index:1000;background:#15181e;color:white;padding:12px';document.body.append(box);
function Fixture(){const [,render]=useState(0);useEffect(()=>{const listener=()=>render(n=>n+1);queue.listeners.add(listener);return()=>queue.listeners.delete(listener)},[]);return <BulkHistory records={queue.records} activeIds={queue.activeIds} onCompose={()=>{}} onDelete={async()=>{}} onStop={id=>queue.stop(id)} onReconcile={id=>queue.reconcile(id)} onEdit={(id,text,targets)=>queue.edit(id,text,targets)} onRevoke={(id,targets)=>queue.revoke(id,targets)}/>}
const root=createRoot(box);root.render(<Fixture/>);
window.__zlBulkCorrections={...fixture,fixture,queue,dispose:()=>{root.unmount();queue.dispose();box.remove();delete window.__zlBulkCorrections;}};
`;
let installed = false;
const fill = value =>
  evaluate(
    `(()=>{const input=document.querySelector('#bulk-edit-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
try {
  const built = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    packages: 'external',
  });
  await evaluate(built.outputFiles[0].text);
  installed = true;
  await wait(`!!document.querySelector('.bulk-history')`, 'history ready');
  await clickText('核对发送结果');
  await wait(
    `window.__zlBulkCorrections.queue.records[0].success===5 && !!document.querySelector('[role=dialog]')`,
    'false failures reconciled',
  );
  assert.equal(
    await evaluate(`window.__zlBulkCorrections.queue.records[0].failed`),
    0,
  );
  assert.equal(
    await evaluate(`window.__zlBulkCorrections.queue.records[0].status`),
    '已完成',
  );
  assert.equal(await evaluate(`window.__zlBulkCorrections.fixture.sent`), 0);
  await clickText('关闭详情');
  await wait(`!document.querySelector('[role=dialog]')`, 'details closed');
  await clickText('编辑已发消息');
  await wait(`!!document.querySelector('#bulk-edit-message')`, 'edit dialog');
  await fill('第一次更正');
  await clickText('确认编辑消息');
  await wait(
    `!!window.__zlBulkCorrections.queue.records[0].editEnded && !document.querySelector('#bulk-edit-message')`,
    'per-target editing completed',
  );
  assert.equal(
    await evaluate(`window.__zlBulkCorrections.fixture.edited.length`),
    4,
  );
  assert(
    await evaluate(
      `document.querySelector('[role=dialog]').textContent.includes('已超出15分钟时限')`,
    ),
  );
  assert.equal(await evaluate(`window.__zlBulkCorrections.fixture.sent`), 0);
  await clickText('关闭详情');
  await wait(`!document.querySelector('[role=dialog]')`, 'edit results closed');
  await evaluate(`window.__zlBulkCorrections.fixture.allowAll=true`);
  await clickText('编辑已发消息');
  await wait(`!!document.querySelector('#bulk-edit-message')`, 'second edit');
  await fill('第二次更正');
  // Select one recipient, preserving all other targets' successful corrections.
  await evaluate(
    `[...document.querySelectorAll('[id^="edit-fixture-account:"]')].slice(1).forEach(n=>n.click())`,
  );
  await clickText('确认编辑消息');
  await wait(
    `window.__zlBulkCorrections.fixture.edited.length===5`,
    'only selected target edited',
  );
  assert.equal(
    await evaluate(`window.__zlBulkCorrections.fixture.edited.at(-1).id`),
    'recovered-10001@g.us',
  );
  await wait(
    `!document.querySelector('#bulk-edit-message')`,
    'edit dialog closed',
  );
  await clickText('关闭详情');
  await wait(
    `!document.querySelector('[role=dialog]')`,
    'details closed before revoke',
  );
  await clickText('撤回已发消息');
  await wait(
    `document.querySelectorAll('[id^="revoke-fixture-account:"]').length===5`,
    'recovered IDs available for revoke',
  );
  await evaluate(
    `[...document.querySelectorAll('[id^="revoke-fixture-account:"]')].slice(1).forEach(n=>n.click())`,
  );
  await clickText('确认撤回消息');
  await wait(
    `window.__zlBulkCorrections.fixture.revoked.length===1`,
    'selected recovered message revoked',
  );
  assert.equal(
    await evaluate(`window.__zlBulkCorrections.fixture.revoked[0].id`),
    'recovered-10001@g.us',
  );
  assert.equal(await evaluate(`window.__zlBulkCorrections.fixture.sent`), 0);
  assert(
    !(await evaluate(
      `[...document.querySelectorAll('.bulk-history__more button')].some(n=>n.textContent==='删除记录')`,
    )),
  );
  console.log(
    'PASS false failure recovery, recovered-ID revoke, real edit confirmation and recipient selection, partial failures and no resends',
  );
} finally {
  if (installed) await evaluate(`window.__zlBulkCorrections?.dispose()`);
  socket.close();
}
