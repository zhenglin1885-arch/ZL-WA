/* eslint-disable no-console -- Command-line GUI verification output. */
import assert from 'node:assert/strict';

export async function verifyBulkMultitask({
  first,
  service,
  guest,
  evaluate,
  wait,
  clickText,
  shot,
  queueExpression,
}) {
  const longText = '并行任务 A 第一行\n第二行内容\n第三行内容\n第四行内容';
  const shortText = '并行任务 B';
  await guest(first, 'fixture.holdBulk=true;fixture.bulkReleases=[];true');
  await clickText('☷群发');
  const create = async (text, all = false, deny = false) => {
    await clickText('新建转发');
    await wait(
      `!!document.querySelector('.bulk-columns')`,
      'new task form remains available during another send',
    );
    await evaluate(
      `(()=>{const n=document.getElementById(${JSON.stringify(`bulk-account-${first}`)});if(!n.checked)n.click()})()`,
    );
    await clickText('读取聊天对象');
    await wait(
      `document.querySelectorAll('.bulk-recipient-list input').length===2`,
      'concurrent task recipients',
    );
    await evaluate(
      all
        ? `document.querySelector('.bulk-columns fieldset:nth-child(2) > label input').click()`
        : `document.querySelector('.bulk-recipient-list input').click()`,
    );
    await clickText('文本');
    await evaluate(
      `(()=>{const n=document.querySelector('[aria-label="发送内容"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,${JSON.stringify(text)});n.dispatchEvent(new Event('input',{bubbles:true}));const interval=document.querySelector('#bulk-min');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(interval,'0.5');interval.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await clickText('检查并发送');
    if (deny) await guest(first, 'fixture.chats[0].isReadOnly=true;true');
    await clickText('确认发送');
    await wait(
      `${queueExpression}.records.some(r=>r.text===${JSON.stringify(text)})`,
      'concurrent task persisted',
    );
    return evaluate(
      `${queueExpression}.records.find(r=>r.text===${JSON.stringify(text)}).id`,
    );
  };
  const firstId = await create(longText, true);
  await wait(
    `${service(first)}.webview.executeJavaScript('fixture.bulkReleases.length').then(n=>n===1)`,
    'first send held',
  );
  const secondId = await create(shortText);
  await wait(
    `${queueExpression}.activeIds.size===2 && ${service(first)}.webview.executeJavaScript('fixture.bulkReleases.length').then(n=>n===2)`,
    'two jobs executing concurrently',
  );
  const preview = await evaluate(
    `(()=>{const n=[...document.querySelectorAll('.bulk-history__text')].find(e=>e.textContent===${JSON.stringify(longText)});const style=getComputedStyle(n);return {height:n.getBoundingClientRect().height,lineHeight:parseFloat(style.lineHeight),clamp:style.webkitLineClamp,overflow:style.overflowY}})()`,
  );
  assert.equal(preview.clamp, '2');
  assert.equal(preview.overflow, 'hidden');
  assert(
    preview.height <= preview.lineHeight * 2 + 1,
    'history content occupies at most two lines',
  );
  await shot('/workspace/ZL-WA-bulk-concurrent.png');
  await evaluate(
    `(()=>{const row=[...document.querySelectorAll('.bulk-history tbody tr')].find(r=>r.querySelector('.bulk-history__text')?.textContent===${JSON.stringify(longText)});[...row.querySelectorAll('button')].find(b=>b.textContent==='停止发送').click()})()`,
  );
  await guest(
    first,
    `fixture.holdBulk=false;fixture.bulkReleases.splice(0).forEach(resolve=>resolve('OK'));true`,
  );
  await wait(
    `${queueExpression}.records.find(r=>r.id===${JSON.stringify(firstId)})?.status==='已停止' && ${queueExpression}.records.find(r=>r.id===${JSON.stringify(secondId)})?.status==='已完成' && ${queueExpression}.activeIds.size===0`,
    'one job stops while the other completes',
  );
  assert.equal(
    await guest(
      first,
      `fixture.bulk.filter(r=>r.text===${JSON.stringify(longText)}).length`,
    ),
    1,
    'stopped job does not send to the remaining recipient',
  );
  assert.equal(
    await guest(
      first,
      `fixture.bulk.filter(r=>r.text===${JSON.stringify(shortText)}).length`,
    ),
    1,
    'concurrent job sends exactly once',
  );
  const openDetail = async text => {
    await evaluate(
      `(()=>{const row=[...document.querySelectorAll('.bulk-history tbody tr')].find(r=>r.querySelector('.bulk-history__text')?.textContent===${JSON.stringify(text)});[...row.querySelectorAll('button')].find(b=>b.textContent==='详情').click()})()`,
    );
    await wait(
      `!!document.querySelector('.bulk-delivery')`,
      'compact send result',
    );
  };
  await openDetail(shortText);
  const detail = await evaluate(
    `[...document.querySelectorAll('.bulk-delivery')].map(e=>e.innerText).join(' ')`,
  );
  assert(detail.includes('成功'));
  assert(
    !/消息编号|服务器已接受|发送时间|核对时间/.test(detail),
    'details omit internal identifiers and timestamps',
  );
  await clickText('关闭详情');
  const failedText = '并行测试失败原因';
  await create(failedText, false, true);
  await wait(
    `${queueExpression}.records.find(r=>r.text===${JSON.stringify(failedText)})?.failed===1 && ${queueExpression}.activeIds.size===0`,
    'failed task result',
  );
  await guest(first, 'fixture.chats[0].isReadOnly=false;true');
  await openDetail(failedText);
  const failure = await evaluate(
    `document.querySelector('.bulk-delivery').innerText`,
  );
  assert(
    failure.includes('失败原因：') && failure.includes('没有发送权限'),
    'failed result includes its cause',
  );
  await shot('/workspace/ZL-WA-bulk-failure-detail.png');
  await clickText('关闭详情');
  await clickText('关闭');
  console.log(
    'PASS compact two-line previews, concise success/failure details, creation during active sends, two simultaneous jobs and independent cancellation',
  );
}
