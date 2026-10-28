/* eslint-disable no-console, no-await-in-loop -- Sequential synthetic replies through the actual composer, queue and serialized guest. */
import assert from 'node:assert/strict';

export async function verifyBulkReplies({
  first,
  second,
  guest,
  evaluate,
  wait,
  click,
  clickText,
  shot,
}) {
  const expression = `require('./features/accountTools/bulkRuntime').getBulkQueue(window.ferdium.stores)`;
  const bulkBefore = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences')`,
  );
  const replyBefore = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-reply-preferences')`,
  );
  const recordsBefore = await evaluate(`${expression}.records.map(r=>r.id)`);
  const fill = (label, text) =>
    evaluate(
      `(()=>{const n=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(${label === '回复匹配规则' ? 'HTMLSelectElement' : label === '会话发送间隔' ? 'HTMLInputElement' : 'HTMLTextAreaElement'}.prototype,'value').set.call(n,${JSON.stringify(text)});n.dispatchEvent(new Event(${label === '回复匹配规则' ? "'change'" : "'input'"},{bubbles:true}))})()`,
    );
  try {
    await evaluate(
      `require('electron').ipcRenderer.invoke('account-tools-reply-preferences',require('./features/accountTools/bulkPreferences').normalizeReplyPreferences({}))`,
    );
    for (const [index, id] of [first, second].entries())
      await guest(
        id,
        `(()=>{
      fixture.replyPreviousWPP=window.WPP;fixture.replyPreviousRequire=window.require;fixture.replyCalls=[];
      const chats=[{id:{_serialized:'10001@g.us',server:'g.us',user:'10001'},name:'测试群组 A'},{id:{_serialized:'10002@c.us',server:'c.us',user:'10002'},name:'测试联系人 B'}];
      window.require=name=>name==='WAWebCollections'?{...fixture.replyPreviousRequire(name),Chat:{getModelsArray:()=>chats,get:id=>chats.find(c=>c.id._serialized===id)}}:fixture.replyPreviousRequire(name);const letter=${JSON.stringify(index === 0 ? 'A' : 'B')};
      const rows=chat=>[
        {id:'false_'+chat+'_'+letter+'_OLD',type:'chat',body:'目标消息内容',t:1},
        {id:'false_'+chat+'_'+letter+'_NEW',type:'chat',body:'目标消息内容',t:2}];
      window.WPP={isReady:true,conn:{getMyUserWid:()=>fixture.ownPhone+'@c.us'},chat:{
        get:async()=>({}),getMessages:async chat=>rows(chat),
        getMessageById:async id=>rows(id.split('_')[1]).find(m=>m.id===id),
        sendTextMessage:async(chat,text,options)=>{fixture.replyCalls.push({chat,text,options});return{id:'true_'+chat+'_SENT'+fixture.replyCalls.length,ack:1}}
      }};return true;
    })()`,
      );
    await click('[aria-label="回复"]');
    await wait(
      `!!document.querySelector('[aria-label="回复匹配内容"]') && !document.querySelector('#bulk-account-${first}').disabled`,
      'reply composer opens directly',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="回复"]').previousElementSibling.textContent.trim()`,
      ),
      '点赞',
    );
    for (const id of [first, second]) await click(`#bulk-account-${id}`);
    await clickText('读取聊天对象');
    await wait(
      `document.querySelectorAll('.bulk-recipient-list input').length===4`,
      'reply targets from both accounts',
    );
    await evaluate(
      `document.querySelectorAll('.bulk-recipient-list input').forEach(n=>n.click())`,
    );
    await fill('回复匹配内容', '目标消息内容');
    await fill('发送内容', '引用回复正文');
    await evaluate(
      `(()=>{const n=document.querySelector('#bulk-min');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'0.5');n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await shot('/workspace/ZL-WA-bulk-reply-compose.png');
    await clickText('检查并发送');
    await wait(
      `document.querySelectorAll('[role="dialog"]').length===2`,
      'reply confirmation',
    );
    for (const id of [first, second])
      assert.equal(
        await guest(id, 'fixture.replyCalls.length'),
        0,
        'confirmation does not send',
      );
    await clickText('确认发送');
    await wait(
      `${expression}.activeIds.size===0 && ${expression}.records.some(r=>r.spec?.reply && r.success===4)`,
      'four quoted replies complete',
    );
    for (const [index, id] of [first, second].entries()) {
      const calls = await guest(id, 'fixture.replyCalls');
      assert.equal(calls.length, 2);
      assert(
        calls.every(
          c =>
            c.options.quotedMsg ===
              `false_${c.chat}_${index === 0 ? 'A' : 'B'}_NEW` &&
            c.text === '引用回复正文' &&
            !c.options.mentionedList,
        ),
      );
    }
    assert.deepEqual(
      await evaluate(
        `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences')`,
      ),
      bulkBefore,
      'ordinary bulk settings unchanged',
    );
    await shot('/workspace/ZL-WA-bulk-reply-results.png');
    await click('[aria-label="关闭回复窗口"]');
    await clickText('☷群发');
    await wait(
      `!!document.querySelector('[aria-label="关闭转发窗口"]')`,
      'ordinary bulk opens',
    );
    assert.equal(
      await evaluate(`!!document.querySelector('[aria-label="回复匹配内容"]')`),
      false,
    );
    assert.equal(
      await evaluate(
        `!![...document.querySelectorAll('.bulk-history__text')].find(n=>n.textContent==='引用回复正文')`,
      ),
      false,
      'reply records stay out of ordinary bulk history',
    );
    await click('[aria-label="关闭转发窗口"]');
    await click('[aria-label="回复"]');
    await wait(
      `document.querySelector('[aria-label="回复匹配内容"]')?.value==='目标消息内容'`,
      'reply matching settings persist',
    );
    await click(`#bulk-account-${first}`);
    await clickText('读取聊天对象');
    await wait(
      `document.querySelectorAll('.bulk-recipient-list input').length===2`,
      'no-match targets',
    );
    await click('.bulk-recipient-list input');
    await fill('回复匹配内容', '不会存在的目标消息');
    await fill('发送内容', '绝不能普通发送');
    await clickText('检查并发送');
    await clickText('确认发送');
    await wait(
      `${expression}.activeIds.size===0 && ${expression}.records.some(r=>r.spec?.reply?.text==='不会存在的目标消息' && r.failed===1)`,
      'no match is a per-target failure',
    );
    assert.equal(
      await guest(first, 'fixture.replyCalls.length'),
      2,
      'no fallback send on missing target',
    );
    const original =
      'Mas e pra quem tá começando do zero, igual eu, que nem sabe mexer no aplicativo ainda? 😅 Como faço pra abrir uma conta numa corretora e começar a acompanhar as operações aqui do grupo? 🙏';
    const targets = [];
    for (const id of [first, second]) {
      const ownerId = await guest(id, `fixture.ownPhone+'@c.us'`);
      for (const chat of ['10001@g.us', '10002@c.us'])
        targets.push({
          accountId: id,
          ownerId,
          id: chat,
          name: chat,
          group: chat.endsWith('@g.us'),
        });
      await guest(
        id,
        `(()=>{
        const text=${JSON.stringify(original)},read=WPP.chat.getMessageById;
        const indexed=chat=>({id:'false_'+chat+'_PORTUGUESE',body:text.normalize('NFD').replaceAll(' ','\u00A0')+'\u200B',type:'chat',t:4});
        fixture.replyIndexCalls=[];
        WPP.chat.get=async chat=>({id:{_serialized:chat}});
        WPP.chat.getMessages=async()=>[];
        WPP.chat.getMessageById=async id=>id.endsWith('_PORTUGUESE')?indexed(id.split('_')[1]):read(id);
        WPP.whatsapp={functions:{msgFindSearch:async query=>{
          if(query.searchTerm!==text||!query.remote?._serialized)throw Error('Unexpected native scoped search query');
          fixture.replyIndexCalls.push(query.remote._serialized);
          return {messages:[indexed(query.remote._serialized),indexed('99999@g.us')],eof:true};
        }}};return true;
      })()`,
      );
    }
    const input = {
      type: 'text',
      text: 'Portuguese quote regression',
      reply: { text: original, match: 'exact' },
      targets,
      intervalMin: 0.5,
      intervalMax: 0.5,
      typingSeconds: 0,
      mentionAll: false,
      failure: 'continue',
    };
    const indexed = await evaluate(
      `(async()=>{const q=${expression};const id=await q.submit(${JSON.stringify(input)});return q.records.find(r=>r.id===id)})()`,
    );
    assert.equal(
      indexed.success,
      4,
      'references outside loaded scrollback are found by indexed search',
    );
    for (const id of [first, second]) {
      assert.equal(
        await guest(id, 'fixture.replyCalls.length'),
        4,
        'one dispatch per target',
      );
      assert(
        await guest(
          id,
          `fixture.replyCalls.slice(-2).every(c=>c.options.quotedMsg==='false_'+c.chat+'_PORTUGUESE')`,
        ),
      );
      assert.equal(await guest(id, 'fixture.replyIndexCalls.length'), 2);
    }
    console.log(
      'PASS reported Portuguese text: native scoped search outside loaded history, Unicode/emoji preservation, exact quote IDs and one dispatch per account/chat',
    );
    await click('[aria-label="关闭回复窗口"]');
    console.log(
      'PASS native bulk replies: two accounts, group/private targets, latest quotes, explicit confirmation, no automatic mentions, isolated preferences/history and no ordinary fallback',
    );
  } catch (error) {
    console.error(
      'Reply fixture diagnostics',
      await evaluate(
        `${expression}.records.filter(r=>!${JSON.stringify(recordsBefore)}.includes(r.id)).map(r=>({status:r.status,success:r.success,failed:r.failed,details:r.details,deliveries:r.deliveries?.map(d=>({status:d.status,error:d.error}))}))`,
      ),
    );
    throw error;
  } finally {
    await evaluate(
      `(async()=>{const q=${expression};const ids=q.records.filter(r=>!${JSON.stringify(recordsBefore)}.includes(r.id)).map(r=>r.id);for(const id of ids)await q.stop(id);if(q.activeIds.size)throw Error('Reply test still active');await q.remove(ids);await require('electron').ipcRenderer.invoke('account-tools-reply-preferences',${JSON.stringify(replyBefore)});return true})()`,
    );
    for (const id of [first, second])
      await guest(
        id,
        'window.WPP=fixture.replyPreviousWPP;window.require=fixture.replyPreviousRequire;true',
      );
  }
}
