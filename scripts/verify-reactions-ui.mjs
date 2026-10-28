/* eslint-disable no-console, no-await-in-loop -- Native Electron UI regression with synthetic WhatsApp accounts. */
import assert from 'node:assert/strict';

export async function verifyReactions({
  first,
  second,
  guest,
  evaluate,
  wait,
  click,
  clickText,
  shot,
}) {
  const expression = `require('./features/reactions/runtime').getReactionRuntime(window.ferdium.stores).queue`;
  const before = await evaluate(
    `require('electron').ipcRenderer.invoke('reaction-tools-load')`,
  );
  try {
    for (const id of [first, second])
      await guest(
        id,
        `(()=>{
      fixture.installGroupTools();fixture.reactionCalls=[];
      fixture.reactionMessages=['10001@g.us','10003@g.us'].flatMap(g=>[
        {id:'false_'+g+'_OLD',body:'点赞验证消息',type:'chat',t:1},
        {id:'false_'+g+'_NEW',body:'点赞验证消息',type:'chat',t:2},
        {id:'false_'+g+'_OTHER',body:'其他内容',type:'chat',t:3}]);
      WPP.chat.getMessages=async(g,options)=>options.id?[]:fixture.reactionMessages.filter(m=>m.id.includes('_'+g+'_'));
      WPP.chat.getMessageById=async id=>fixture.reactionMessages.find(m=>m.id===id);
      WPP.chat.sendReactionToMessage=async(id,emoji)=>{fixture.reactionCalls.push({id,emoji,at:Date.now()});return{sendMsgResult:undefined}};
      WPP.chat.getReactions=async id=>{const mine=fixture.reactionCalls.find(c=>c.id===id);return{reactionByMe:mine?{reactionText:mine.emoji}:undefined}};
      return true;
    })()`,
      );
    await click('[aria-label="点赞"]');
    await wait(
      `!!document.querySelector('.reaction-tools-dialog') && !document.querySelector('.reaction-accounts button').disabled`,
      'reaction dialog loaded',
    );
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('[aria-label="点赞匹配文字"]')).color`,
      ),
      'rgb(234, 241, 251)',
      'dark inputs retain readable foreground',
    );
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.reaction-accounts button')).fontSize`,
      ),
      '14px',
      'action buttons remain readable',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="点赞"]').previousElementSibling.textContent.trim()`,
      ),
      '退群',
    );
    await click(`.reaction-accounts [data-account-id="${first}"] input`);
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===3 && !document.querySelector('.reaction-groups button').disabled`,
      'first groups read',
    );
    await click(`.reaction-accounts [data-account-id="${second}"] input`);
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===3 && !document.querySelector('.reaction-groups button').disabled`,
      'shared groups merged',
    );
    await click('.reaction-groups [data-group-id="10001@g.us"] input');
    await click('.reaction-groups [data-group-id="10003@g.us"] input');
    await evaluate(
      `(()=>{const n=document.querySelector('[aria-label="点赞匹配文字"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'点赞验证消息');n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await evaluate(
      `(()=>{const n=document.querySelector('[aria-label="点赞执行时间方式"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'interval');n.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    for (const label of ['点赞最短间隔', '点赞最长间隔'])
      await evaluate(
        `(()=>{const n=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'1');n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
    await click('[aria-label="表情 ❤️"]');
    await clickText('查找匹配消息');
    await wait(
      `document.querySelectorAll('.reaction-preview article').length===4 && [...document.querySelectorAll('.reaction-tools-dialog button')].some(b=>b.textContent==='开始点赞'&&!b.disabled)`,
      'four newest matched messages previewed',
    );
    // Large account/group previews remain bounded; counts refer to executable
    // account/group tasks, not the number of merged group rows or cards shown.
    for (const id of [first, second])
      await guest(
        id,
        `(()=>{
        for(let i=0;i<5;i++){
          const g=(20001+i)+'@g.us';
          fixture.groupRows.push({id:g,subject:'折叠测试群 '+i,member:true,admin:true,chat:true});
          fixture.reactionMessages.push({id:'false_'+g+'_NEW',body:i===4?'没有匹配':'点赞验证消息',type:'chat',t:2});
        }return true;
      })()`,
      );
    await clickText('刷新群组');
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===8 && !document.querySelector('.reaction-groups button').disabled`,
      'large group inventory',
    );
    for (let i = 0; i < 5; i += 1)
      await click(
        `.reaction-groups [data-group-id="${20_001 + i}@g.us"] input`,
      );
    await clickText('查找匹配消息');
    await wait(
      `document.querySelector('.reaction-match-summary').textContent.includes('匹配任务 12 项') && document.querySelector('.reaction-find-progress').textContent.includes('14/14')`,
      'two-account matching task sum excludes misses',
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.reaction-preview article').length`,
      ),
      10,
    );
    assert(
      await evaluate(
        `document.querySelector('.reaction-preview').getBoundingClientRect().height<=360`,
      ),
      'preview height bounded',
    );
    await clickText('展开全部 14 条结果');
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.reaction-preview article').length`,
      ),
      14,
    );
    assert(
      await evaluate(
        `document.querySelector('.reaction-preview').getBoundingClientRect().height<=360`,
      ),
      'expanded preview still bounded',
    );
    await clickText('收起，仅显示前10条');
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.reaction-preview article').length`,
      ),
      10,
    );
    await evaluate(
      `document.querySelector('.reaction-execution-actions').scrollIntoView({block:'center'})`,
    );
    assert(
      await evaluate(
        `(()=>{const b=document.querySelector('.reaction-execution-actions button'),r=b.getBoundingClientRect();return !b.disabled&&r.top>=0&&r.bottom<=innerHeight})()`,
      ),
      'execute remains reachable',
    );
    await shot('/workspace/ZL-WA-reactions-folded.png');
    await click(`.reaction-accounts [data-account-id="${second}"] input`);
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===8 && !document.querySelector('.reaction-groups button').disabled`,
      'single-account inventory',
    );
    await clickText('查找匹配消息');
    await wait(
      `document.querySelector('.reaction-match-summary').textContent.includes('匹配任务 6 项') && document.querySelector('.reaction-find-progress').textContent.includes('7/7')`,
      'single-account total',
    );
    await click(`.reaction-accounts [data-account-id="${second}"] input`);
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===8 && !document.querySelector('.reaction-groups button').disabled`,
      'restore two accounts',
    );
    for (const id of [first, second])
      await guest(
        id,
        `fixture.groupRows=fixture.groupRows.filter(g=>!g.id.startsWith('2000'));true`,
      );
    await clickText('刷新群组');
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===3 && !document.querySelector('.reaction-groups button').disabled`,
      'restore original inventory',
    );
    await clickText('查找匹配消息');
    await wait(
      `document.querySelectorAll('.reaction-preview article').length===4 && document.querySelector('.reaction-match-summary').textContent.includes('匹配任务 4 项')`,
      'original preview restored',
    );
    console.log(
      'PASS reaction result folding at ten rows, bounded expanded list, reachable execution action, and live multi-account task totals excluding misses',
    );
    for (const id of [first, second])
      assert.equal(
        await guest(id, 'fixture.reactionCalls.length'),
        0,
        'preview is read only',
      );
    await evaluate(
      `document.querySelector('.reaction-preview').scrollIntoView({block:'center'})`,
    );
    await shot('/workspace/ZL-WA-reactions-preview.png');
    await clickText('开始点赞');
    await wait(`${expression}.active!==''`, 'reaction schedule running');
    await click('[aria-label="关闭批量点赞"]');
    await wait(
      `!${expression}.active && ${expression}.state.batches[0].tasks.every(t=>t.status==='success')`,
      'closed dialog keeps sequential queue running',
    );
    const calls = [];
    for (const id of [first, second]) {
      const values = await guest(id, 'fixture.reactionCalls');
      assert.equal(values.length, 2);
      assert(
        values.every(
          c => c.id.endsWith('_NEW') && ['👍', '❤️'].includes(c.emoji),
        ),
      );
      calls.push(...values);
    }
    calls.sort((a, b) => a.at - b.at);
    for (let i = 1; i < calls.length; i += 1)
      assert(
        calls[i].at - calls[i - 1].at >= 900,
        'native calls are staggered',
      );
    await click('[aria-label="点赞"]');
    await wait(
      `document.querySelectorAll('.reaction-tools-dialog [data-task-status="success"]').length===4`,
      'results persist on reopen',
    );
    await evaluate(
      `document.querySelector('.reaction-tools-dialog .group-tools-log').scrollIntoView({block:'center'})`,
    );
    await shot('/workspace/ZL-WA-reactions-results.png');
    await evaluate(
      `(async()=>{const q=${expression};q.state.batches[0].tasks.forEach(t=>{t.status='uncertain';t.result='旧版未确认'});await require('electron').ipcRenderer.invoke('reaction-tools-save',q.state);return true})()`,
    );
    await click('[aria-label="关闭批量点赞"]');
    await click('[aria-label="点赞"]');
    await wait(
      `!![...document.querySelectorAll('.reaction-tools-dialog button')].find(b=>b.textContent==='核验未确认结果')`,
      'read-only verification action',
    );
    await clickText('核验未确认结果');
    await wait(
      `!${expression}.active && ${expression}.state.batches[0].tasks.every(t=>t.status==='success')`,
      'old uncertain results reconciled read-only',
    );
    for (const id of [first, second])
      assert.equal(
        await guest(id, 'fixture.reactionCalls.length'),
        2,
        'verification never resends',
      );
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.reaction-rules')).overflow`,
      ),
      'hidden',
    );
    await click('[aria-label="关闭批量点赞"]');
    // Use the real scheduling UI for a future window, then cancel before dispatch.
    await click('[aria-label="点赞"]');
    await wait(
      `!!document.querySelector('.reaction-tools-dialog') && !document.querySelector('.reaction-accounts button').disabled`,
      'reopen for window',
    );
    await click(`.reaction-accounts [data-account-id="${first}"] input`);
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===3 && !document.querySelector('.reaction-groups button').disabled`,
      'window groups',
    );
    await click('.reaction-groups [data-group-id="10001@g.us"] input');
    await evaluate(
      `(()=>{const n=document.querySelector('[aria-label="点赞执行时间方式"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'window');n.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    // Saved preferences may contain yesterday's window. Give this scheduling
    // fixture its own future times instead of depending on persisted defaults.
    for (const [label, minutes] of [
      ['点赞开始时间', 5],
      ['点赞结束时间', 15],
    ])
      await evaluate(
        `(()=>{const d=new Date(Date.now()+${minutes}*60000);const value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);const n=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      );
    await clickText('查找匹配消息');
    await wait(
      `document.querySelectorAll('.reaction-preview article').length===1 && [...document.querySelectorAll('.reaction-tools-dialog button')].some(b=>b.textContent==='开始点赞'&&!b.disabled)`,
      'window preview',
    );
    await clickText('开始点赞');
    await wait(`${expression}.active!==''`, 'future window active');
    const scheduled = await evaluate(`${expression}.state.batches[0]`);
    assert.equal(scheduled.rules.timing, 'window');
    assert(
      scheduled.tasks[0].plannedAt >= scheduled.rules.start &&
        scheduled.tasks[0].plannedAt < scheduled.rules.end,
    );
    assert.equal(await guest(first, 'fixture.reactionCalls.length'), 2);
    await clickText('终止执行');
    await wait(`!${expression}.active`, 'scheduled task stopped');
    await click('[aria-label="关闭批量点赞"]');
    const images = await evaluate(`(()=>{
      const c=document.createElement('canvas');c.width=480;c.height=320;const x=c.getContext('2d');
      const g=x.createLinearGradient(0,0,480,320);g.addColorStop(0,'#14286f');g.addColorStop(1,'#a8f2ba');x.fillStyle=g;x.fillRect(0,0,480,320);
      x.fillStyle='#ffa830';x.fillRect(40,30,180,170);x.fillStyle='white';x.font='30px sans-serif';x.fillText('REACTION IMAGE',80,260);
      const original=c.toDataURL('image/png');const small=document.createElement('canvas');small.width=240;small.height=160;small.getContext('2d').drawImage(c,0,0,240,160);
      const compressed=small.toDataURL('image/jpeg',0.55);x.fillStyle='#d6154e';x.fillRect(0,0,480,320);
      return{original,compressed,different:c.toDataURL('image/png')};
    })()`);
    await guest(
      first,
      `(()=>{
      fixture.reactionMessages=[
        {id:'false_10001@g.us_IMAGE_OLD',type:'image',filehash:'image-old',body:'',t:1},
        {id:'false_10001@g.us_IMAGE_NEW',type:'image',filehash:'image-new',body:'图片附言不参与匹配',t:2},
        {id:'false_10001@g.us_DIFFERENT',type:'image',filehash:'image-other',body:'',t:3}];
      const images=${JSON.stringify(images)};
      WPP.chat.downloadMedia=async id=>(await fetch(id.endsWith('DIFFERENT')?images.different:id.endsWith('IMAGE_NEW')?images.compressed:images.original)).blob();return true;
    })()`,
    );
    await click('[aria-label="点赞"]');
    await wait(
      `!!document.querySelector('.reaction-tools-dialog') && !document.querySelector('.reaction-accounts button').disabled`,
      'image mode loaded',
    );
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('.reaction-tools-dialog button')].find(b=>b.textContent==='开始点赞').nextElementSibling.textContent`,
      ),
      '终止执行',
    );
    await click(`.reaction-accounts [data-account-id="${first}"] input`);
    await wait(
      `document.querySelectorAll('.reaction-groups .group-tools-group').length===3 && !document.querySelector('.reaction-groups button').disabled`,
      'image groups',
    );
    await click('.reaction-groups [data-group-id="10001@g.us"] input');
    await clickText('匹配图片');
    await evaluate(`(async()=>{
      const blob=await(await fetch(${JSON.stringify(images.original)})).blob();const data=new DataTransfer();data.items.add(new File([blob],'reference.png',{type:'image/png'}));
      const input=document.querySelector('[aria-label="上传点赞匹配图片"]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait(
      `!!document.querySelector('[alt="上传的匹配图片预览"]') && ![...document.querySelectorAll('.reaction-tools-dialog button')].find(b=>b.textContent==='选择匹配图片')?.disabled`,
      'uploaded reference preview',
    );
    await evaluate(
      `(()=>{const n=document.querySelector('[aria-label="点赞执行时间方式"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'interval');n.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    await shot('/workspace/ZL-WA-reactions-image-reference.png');
    await clickText('查找匹配消息');
    await wait(
      `document.querySelectorAll('.reaction-preview [alt="查找到的匹配图片预览"]').length===1 && [...document.querySelectorAll('.reaction-tools-dialog button')].some(b=>b.textContent==='开始点赞'&&!b.disabled)`,
      'compressed image matched with preview',
    );
    await evaluate(
      `document.querySelector('.reaction-preview').scrollIntoView({block:'center'})`,
    );
    assert(
      await evaluate(
        `document.querySelector('[alt="查找到的匹配图片预览"]').getBoundingClientRect().width<=190`,
      ),
    );
    await shot('/workspace/ZL-WA-reactions-image-match.png');
    await clickText('开始点赞');
    await wait(
      `!${expression}.active && ${expression}.state.batches[0].tasks[0].status==='success' && ${expression}.state.batches[0].rules.content==='image'`,
      'image reaction complete',
    );
    assert.equal(
      await evaluate(`${expression}.state.batches[0].tasks[0].messageId`),
      'false_10001@g.us_IMAGE_NEW',
    );
    assert.equal(
      await evaluate(`${expression}.state.batches[0].tasks[0].imagePreview`),
      undefined,
      'matched thumbnails are not duplicated in persistent tasks',
    );
    assert.equal(
      await guest(first, 'fixture.reactionCalls.length'),
      3,
      'only one image reaction was sent',
    );
    await clickText('匹配文字');
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="点赞匹配文字"]').value`,
      ),
      '点赞验证消息',
      'switching mode retains the original text setting',
    );
    // Reproduce a message that manual search can find in the same group, but
    // which is outside a 166-message loaded page. Searching must stay read-only.
    const welcome =
      'Sejam muito bem-vindos, novos amigos! 🌹\nNão precisam ter pressa, seja você iniciante no mundo dos investimentos ou alguém ainda se familiarizando com as operações na plataforma. Vamos passar por cada etapa juntos.';
    const beforeLookupCounts = [];
    for (const id of [first, second]) {
      beforeLookupCounts.push(await guest(id, 'fixture.reactionCalls.length'));
      await guest(
        id,
        String.raw`(()=>{
        const text=${JSON.stringify(welcome)},oldRead=WPP.chat.getMessageById;
        const indexed=group=>{
          const mode=fixture.reactionLookupMode;
          const variant=mode==='contains'?'Olá!\n'+text+'\nFim.':mode==='normalized'?text.replaceAll(/\p{P}/gu,'').replaceAll(' ','\n '):text;
          return {id:'false_'+group+'_INDEXED_LOOKUP',body:variant.normalize('NFD').replaceAll(' ','\u00A0').replaceAll('🌹','🌹\uFE0F')+'\u200B',type:'chat',t:10};
        };
        WPP.chat.get=async group=>({id:{_serialized:group}});
        WPP.chat.getMessages=async(group,options)=>options.id?[]:Array.from({length:166},(_,i)=>({id:'false_'+group+'_RECENT'+i,body:'其他内容',type:'chat',t:100+i}));
        WPP.chat.getMessageById=async id=>id.endsWith('_INDEXED_LOOKUP')?indexed(id.split('_')[1]):oldRead(id);
        WPP.whatsapp.functions.msgFindSearch=async query=>{
          if(!query.remote?._serialized)throw Error('Unscoped reaction search');
          return {messages:query.searchTerm===text?[]:[indexed(query.remote._serialized),indexed('99999@g.us')],eof:true};
        };return true;
      })()`,
      );
    }
    for (const id of [first, second]) {
      const selector = `.reaction-accounts [data-account-id="${id}"] input`;
      if (
        !(await evaluate(
          `document.querySelector(${JSON.stringify(selector)}).checked`,
        ))
      )
        await click(selector);
      await wait(
        `document.querySelectorAll('.reaction-groups .group-tools-group').length===3 && !document.querySelector('.reaction-groups button').disabled`,
        'lookup accounts ready',
      );
    }
    for (const group of ['10001@g.us', '10003@g.us']) {
      const selector = `.reaction-groups [data-group-id="${group}"] input`;
      if (
        !(await evaluate(
          `document.querySelector(${JSON.stringify(selector)}).checked`,
        ))
      )
        await click(selector);
    }
    await evaluate(
      `(()=>{const n=document.querySelector('[aria-label="点赞匹配文字"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,${JSON.stringify(welcome)});n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    for (const mode of ['exact', 'contains', 'normalized']) {
      for (const id of [first, second])
        await guest(
          id,
          `fixture.reactionLookupMode=${JSON.stringify(mode)};true`,
        );
      await evaluate(
        `(()=>{const n=document.querySelector('[aria-label="点赞文字匹配方式"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(mode)});n.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      );
      await clickText('查找匹配消息');
      await wait(
        `document.querySelector('.reaction-match-summary').textContent.includes('匹配任务 4 项') && [...document.querySelectorAll('.reaction-tools-dialog button')].some(b=>b.textContent==='查找匹配消息'&&!b.disabled)`,
        `indexed welcome text found using ${mode}`,
      );
      assert.equal(
        await evaluate(
          `document.querySelectorAll('.reaction-preview article').length`,
        ),
        4,
      );
      for (const id of [first, second]) {
        assert.equal(
          await guest(id, 'window.__zlReactionLookup.phase'),
          'verified',
        );
        assert.equal(
          await guest(id, 'window.__zlReactionLookup.indexAvailable'),
          true,
        );
      }
    }
    for (const [index, id] of [first, second].entries())
      assert.equal(
        await guest(id, 'fixture.reactionCalls.length'),
        beforeLookupCounts[index],
        'lookup never sends or repeats a reaction',
      );
    await shot('/workspace/ZL-WA-reactions-indexed-welcome.png');
    console.log(
      'PASS reported welcome text: all three matching modes, scoped DB search beyond 166 loaded messages, two-account totals, correct group/message IDs, Unicode formatting and no mutation during lookup',
    );
    await click('[aria-label="关闭批量点赞"]');
    console.log(
      'PASS native reaction UI: merged groups, multi-account selection, newest-only preview, random emoji selection, staggered background execution, persisted results, cancellable future window, uploaded image previews and compressed-image matching',
    );
  } finally {
    await evaluate(
      `(async()=>{const q=${expression};q.stop();while(q.active)await new Promise(r=>setTimeout(r,50));q.state=${JSON.stringify(before)};await require('electron').ipcRenderer.invoke('reaction-tools-save',q.state);return true})()`,
    );
    for (const id of [first, second])
      await guest(
        id,
        'window.WPP=fixture.beforeGroupWPP;window.require=fixture.beforeGroupRequire;true',
      );
  }
}
