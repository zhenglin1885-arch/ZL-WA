/* eslint-disable no-console, no-await-in-loop -- Sequential synthetic group operations exercise the real Electron UI and queue. */
import assert from 'node:assert/strict';

export async function verifyGroups({
  first,
  second,
  guest,
  evaluate,
  wait,
  click,
  clickText,
  call,
  shot,
}) {
  for (const id of [first, second])
    await guest(id, 'fixture.installGroupTools()');
  const tap = async selector => {
    const point = await evaluate(
      `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await call('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
      });
  };
  const verifyAccountRefresh = async () => {
    await tap('[aria-label="刷新账号列表"]');
    await wait(
      `document.querySelector('.group-tools-accounts [role="status"]')?.textContent.includes('已刷新 2 个账号')`,
      'account refresh has a visible result',
    );
  };
  const finish = async (success, approval = 0, failed = 0) =>
    wait(
      `document.querySelectorAll('.group-tools-log [data-task-status="success"]').length===${success} && document.querySelectorAll('.group-tools-log [data-task-status="approval"]').length===${approval} && document.querySelectorAll('.group-tools-log [data-task-status="failed"]').length===${failed} && ![...document.querySelectorAll('.group-tools-dialog button')].some(b=>b.textContent==='停止执行')`,
      'verified group batch complete',
    );
  const fill = async (selector, text) => {
    const point = await evaluate(
      `(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await call('Input.insertText', { text });
  };
  await click('[aria-label="群组"]');
  await wait(`!!document.querySelector('.group-tools-dialog')`, 'group dialog');
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="群组执行间隔"]').value`,
    ),
    '3',
  );
  await click(`.group-tools-account[data-account-id="${first}"] input`);
  await wait(
    `document.querySelectorAll('.group-tools-group').length===2`,
    'only manageable groups listed',
  );
  await verifyAccountRefresh();
  await wait(
    `!document.querySelector('[aria-label="刷新群组"]').disabled`,
    'group refresh available',
  );
  const readsBefore = await guest(first, 'fixture.groupReads');
  await guest(
    first,
    `fixture.groupRows.find(g=>g.id==='10001@g.us').subject='刷新后的管理群 A';true`,
  );
  await tap('[aria-label="刷新群组"]');
  await wait(
    `document.querySelector('.group-tools-selection').textContent.includes('刷新后的管理群 A') && !document.querySelector('[aria-label="刷新群组"]').disabled`,
    'refresh reads selected account groups',
  );
  assert((await guest(first, 'fixture.groupReads')) > readsBefore);

  await evaluate(
    `document.querySelectorAll('.group-tools-group input').forEach(n=>n.click())`,
  );
  await clickText('全员禁言');
  await finish(2);
  const muteCalls = await guest(
    first,
    `fixture.groupCalls.filter(c=>c.operation==='mute')`,
  );
  assert.equal(
    muteCalls.length,
    3,
    'one lost response is accepted; one unchanged group is retried once',
  );
  assert(muteCalls[1].at - muteCalls[0].at >= 2900);
  assert(muteCalls[2].at - muteCalls[1].at >= 2900);
  await wait(
    `document.querySelectorAll('.group-tools-group').length===2 && !document.querySelector('.group-tools-group input:checked')`,
    'inventory refreshed after operation',
  );
  await evaluate(
    `document.querySelectorAll('.group-tools-group input').forEach(n=>n.click())`,
  );
  await clickText('开启发言');
  await finish(2);
  assert.equal(
    await guest(
      first,
      `fixture.groupRows.filter(g=>g.admin).every(g=>!g.announce)`,
    ),
    true,
  );
  await shot('/workspace/ZL-WA-groups-speech.png');
  await click('[aria-label="关闭群组窗口"]');
  const readsBeforeJoin = {};
  for (const id of [first, second]) {
    readsBeforeJoin[id] = await guest(id, 'fixture.groupReads');
    await guest(id, 'fixture.groupReadLimited=true;true');
  }
  await click('[aria-label="进群"]');
  await wait(
    `document.querySelector('[aria-label="群邀请链接"]')!==null`,
    'join dialog',
  );
  await verifyAccountRefresh();
  await evaluate(
    `document.querySelectorAll('.group-tools-account input').forEach(n=>{if(!n.checked)n.click()})`,
  );
  await fill(
    '[aria-label="群邀请链接"]',
    '欢迎加入群组！\nchat.whatsapp.com/invite/AAAAAAAAAAAAAAAAAAAAAA\nhttps://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBBBB\nhttps://evil.example/not-an-invite\nhttps://chat.whatsapp.com/CCCCCCCCCCCCCCCCCCCCCC\nhttps://chat.whatsapp.com/AAAAAAAAAAAAAAAAAAAAAA?mode=ac_t',
  );
  await fill('[aria-label="群组执行间隔"]', '1');
  await wait(
    `[...document.querySelectorAll('.group-tools-dialog button')].some(b=>b.textContent==='开始进群'&&!b.disabled)`,
    'join inputs ready',
  );
  await clickText('开始进群');
  await wait(
    `!!document.querySelector('.group-tools-log [data-task-status="running"]')`,
    'join started',
  );
  await click('[aria-label="关闭群组窗口"]');
  await wait(
    `!document.querySelector('.group-tools-dialog')`,
    'group window closes while running',
  );
  await click('[aria-label="进群"]');
  await finish(2, 2, 4);
  assert(
    await evaluate(
      `document.querySelector('.group-tools-log').textContent.includes('rate-overlimit') && document.querySelector('.group-tools-log').textContent.includes('无效')`,
    ),
  );
  for (const id of [first, second])
    assert.equal(
      await guest(
        id,
        `fixture.groupCalls.filter(c=>c.operation==='join').length`,
      ),
      3,
      'each account attempts each valid invite once, including a server rejection',
    );
  for (const id of [first, second])
    assert.equal(
      await guest(id, 'fixture.groupLazyLoads'),
      3,
      'each new invitation bootloads the native invite job before submitting',
    );
  await shot('/workspace/ZL-WA-groups-join.png');
  for (const id of [first, second])
    assert.equal(
      await guest(id, 'fixture.groupReads'),
      readsBeforeJoin[id],
      'joins must not fetch all groups',
    );
  for (const id of [first, second])
    await guest(
      id,
      `fixture.groupRows.find(g=>g.id==='90002@g.us').member=true;fixture.groupRows.find(g=>g.id==='90002@g.us').chat=true;true`,
    );
  await clickText('刷新执行结果');
  await finish(4, 0, 4);
  for (const id of [first, second])
    assert.equal(
      await guest(
        id,
        `fixture.groupCalls.filter(c=>c.operation==='join').length`,
      ),
      3,
      'approval refresh is read-only',
    );
  await click('[aria-label="关闭群组窗口"]');
  for (const id of [first, second])
    await guest(
      id,
      `fixture.groupReadLimited=false;fixture.groupLeaveLimited='10004@g.us';true`,
    );
  await click('[aria-label="退群"]');
  await wait(
    `!!document.querySelector('.group-tools-accounts')`,
    'leave dialog',
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.group-tools-counts .group-tools-approval')!==null`,
    ),
    false,
    'leave window has no approval statistic',
  );
  await click(`.group-tools-account[data-account-id="${first}"] input`);
  await wait(
    `document.querySelectorAll('.group-tools-group').length===5`,
    'all joined groups including non-admin groups listed',
  );
  await verifyAccountRefresh();
  await wait(
    `!document.querySelector('[aria-label="刷新群组"]').disabled`,
    'leave group refresh available',
  );
  await tap('[aria-label="刷新群组"]');
  await wait(
    `document.querySelectorAll('.group-tools-group').length===5 && !document.querySelector('[aria-label="刷新群组"]').disabled`,
    'leave refresh reloads all joined groups',
  );

  for (const groupId of ['10001@g.us', '10003@g.us', '10004@g.us'])
    await click(`.group-tools-group[data-group-id="${groupId}"] input`);
  assert.equal(
    await evaluate(
      `document.querySelector('.group-tools-results input[type="checkbox"]').checked`,
    ),
    true,
  );
  await fill('[aria-label="群组执行间隔"]', '1');
  await clickText('开始退群');
  await wait(
    `[...document.querySelectorAll('[role="dialog"] h2')].some(n=>n.textContent==='确认退出并删除群组')`,
    'leave confirmation',
  );
  assert.equal(
    await guest(
      first,
      `fixture.groupCalls.filter(c=>c.operation==='leave').length`,
    ),
    0,
  );
  await clickText('确认退出并删除');
  await finish(2, 0, 1);
  assert(
    await evaluate(
      `document.querySelector('.group-tools-log [data-task-status="failed"]').textContent.includes('rate-overlimit')`,
    ),
  );
  assert.equal(
    await guest(
      first,
      `fixture.groupCalls.filter(c=>c.operation==='leave').length`,
    ),
    3,
  );
  assert.equal(
    await guest(
      first,
      `fixture.groupCalls.filter(c=>c.operation==='delete').length`,
    ),
    3,
    'a missing deletion is retried without leaving again',
  );
  assert.equal(
    await guest(
      second,
      `fixture.groupRows.filter(g=>['10001@g.us','10003@g.us'].includes(g.id)).every(g=>g.member&&g.chat)`,
    ),
    true,
    'unselected account preserved',
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.group-tools-counts > span').length`,
    ),
    3,
  );
  await shot('/workspace/ZL-WA-groups-leave.png');
  await click('[aria-label="关闭群组窗口"]');
  for (const id of [first, second])
    await guest(
      id,
      `window.WPP=fixture.beforeGroupWPP;window.require=fixture.beforeGroupRequire;true`,
    );
  console.log(
    'PASS native group dialogs: admin-only lists, three-second pacing, lost-response reconciliation, bounded retries, every account joins all unique links, pending approvals, background close, read-only refresh, leave/delete recovery and account isolation',
  );
}
