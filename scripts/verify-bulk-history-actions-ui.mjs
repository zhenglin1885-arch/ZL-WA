/* eslint-disable no-console -- GUI regression status. */
import assert from 'node:assert/strict';
import {
  evaluate,
  wait,
  click,
  clickText,
  socket,
} from './account-tools-cdp.mjs';

const mount = async mode => {
  await evaluate(`(()=>{
    const React=require('react');
    const BulkHistory=require('./features/accountTools/BulkHistory').default;
    const host=document.createElement('div');
    host.id='qa-bulk-actions';
    host.style.cssText='position:fixed;inset:0;z-index:1000;background:#14181e;overflow:auto;padding:24px;height:auto';
    document.body.append(host);
    const root=require('react-dom/client').createRoot(host);
    const target={accountId:'qa-account',id:'qa-group@g.us',name:'QA group',group:true};
    const spec={type:'text',text:'original',targets:[target],intervalMin:1,intervalMax:1,typingSeconds:0,mentionAll:false,failure:'continue'};
    const qa={root,host,calls:[],record:{id:'qa-record',text:'original',started:new Date().toISOString(),ended:new Date().toISOString(),status:'已完成',total:1,success:1,failed:0,details:[],spec:${JSON.stringify(mode)}==='legacy'?undefined:spec,deliveries:[{target,status:'sent',messageId:${JSON.stringify(mode)}==='legacy'?'known-native-id':undefined}]}};
    const render=()=>root.render(React.createElement(BulkHistory,{
      records:[qa.record],activeIds:new Set(),onCompose:()=>{},onDelete:async()=>{},onStop:async()=>{},
      onReconcile:async id=>{qa.calls.push({kind:'check',id});qa.record={...qa.record,deliveries:[{target,status:'sent',messageId:${JSON.stringify(mode)}==='ambiguous'?undefined:'recovered-native-id',checkError:${JSON.stringify(mode)}==='ambiguous'?'发现多条相同消息，无法安全确定是哪一条':undefined}]};render();return qa.record},
      onRevoke:async(id,targets)=>{qa.calls.push({kind:'revoke',id,targets})},
      onEdit:async(id,text,targets)=>{qa.calls.push({kind:'edit',id,text,targets})}
    }));
    window.__qaBulkActions=qa;render();return true;
  })()`);
  await wait(
    `!!document.querySelector('#qa-bulk-actions .bulk-history__more')`,
    'history mounted',
  );
  await click('#qa-bulk-actions summary');
};
const cleanup = async () => {
  await evaluate(
    `(()=>{window.__qaBulkActions?.root.unmount();window.__qaBulkActions?.host.remove();delete window.__qaBulkActions;return true})()`,
  );
};
try {
  await mount('recover');
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('#qa-bulk-actions button')].find(b=>b.textContent==='撤回已发消息').disabled`,
    ),
    false,
  );
  await clickText('编辑已发消息');
  await wait(
    `!!document.querySelector('#bulk-edit-message')`,
    'recovered edit dialog',
  );
  assert.equal(
    await evaluate(
      'window.__qaBulkActions.calls.filter(c=>c.kind==="check").length',
    ),
    1,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[id^="edit-qa-account"]')?.checked`,
    ),
    true,
  );
  await clickText('取消');
  await wait(`!document.querySelector('[role="dialog"]')`, 'edit canceled');
  await clickText('撤回已发消息');
  await wait(
    `!!document.querySelector('[id^="revoke-qa-account"]')`,
    'recovered revoke dialog',
  );
  await clickText('确认撤回消息');
  await wait(
    `window.__qaBulkActions.calls.some(c=>c.kind==='revoke')`,
    'revoke invoked',
  );
  assert.deepEqual(
    await evaluate(
      `window.__qaBulkActions.calls.find(c=>c.kind==='revoke').targets`,
    ),
    ['qa-account:qa-group@g.us'],
  );
  assert.equal(
    await evaluate(
      `window.__qaBulkActions.calls.filter(c=>c.kind==='check').length`,
    ),
    1,
  );
  await cleanup();

  await mount('legacy');
  await clickText('编辑已发消息');
  await wait(
    `!!document.querySelector('#bulk-edit-message')`,
    'legacy edit dialog',
  );
  await evaluate(
    `(()=>{const t=document.querySelector('#bulk-edit-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'corrected');t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
  );
  await clickText('确认编辑消息');
  await wait(
    `window.__qaBulkActions.calls.some(c=>c.kind==='edit')`,
    'legacy edit invoked',
  );
  assert.deepEqual(await evaluate(`window.__qaBulkActions.calls`), [
    {
      kind: 'edit',
      id: 'qa-record',
      text: 'corrected',
      targets: ['qa-account:qa-group@g.us'],
    },
  ]);
  await cleanup();

  await mount('ambiguous');
  await clickText('撤回已发消息');
  await wait(
    `document.querySelector('#qa-bulk-actions .tools-notice')?.textContent.includes('多条相同消息')`,
    'ambiguous match reason displayed',
  );
  assert.equal(
    await evaluate(`!!document.querySelector('[role="dialog"]')`),
    false,
  );
  assert.deepEqual(
    await evaluate('window.__qaBulkActions.calls.map(c=>c.kind)'),
    ['check'],
  );
  console.log(
    'PASS recovered history edit/revoke actions, legacy type metadata, selected targets, and ambiguous-message refusal without sending',
  );
} finally {
  await cleanup();
  socket.close();
}
