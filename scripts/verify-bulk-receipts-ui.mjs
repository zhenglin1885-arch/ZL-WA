/* eslint-disable no-console -- Offline native send/receipt integration through the actual bulk runtime. */
import assert from 'node:assert/strict';

export async function verifyBulkReceipts({
  first,
  guest,
  evaluate,
  queueExpression,
}) {
  const before = await evaluate(`${queueExpression}.records.map(r=>r.id)`);
  await guest(
    first,
    `(()=>{
    const collections=window.require('WAWebCollections'),sender=window.require('WAWebSendMsgChatAction');
    fixture.receiptProof={collections,sender,oldStore:collections.Msg,oldSend:sender.addAndSendMsgToChat,count:0,messages:new Map(),mode:'delayed'};
    const p=fixture.receiptProof;
    collections.Msg={get:id=>p.messages.get(id)};
    sender.addAndSendMsgToChat=(chat,message)=>{
      p.count++;message.id.fromMe=true;message.id.remote=chat.id;
      p.messages.set(message.id._serialized,message);
      if(p.mode==='delayed')setTimeout(()=>message.ack=1,400);
      else if(p.count>1)message.ack=1;
      return [Promise.resolve(message),Promise.resolve({})];
    };
    return true;
  })()`,
  );
  const spec = {
    type: 'text',
    text: 'Offline delayed receipt proof',
    intervalMin: 0.5,
    intervalMax: 0.5,
    typingSeconds: 0,
    mentionAll: false,
    failure: 'continue',
    targets: [
      { id: '10001@g.us', accountId: first, name: 'G', group: true },
      { id: '10002@c.us', accountId: first, name: 'P', group: false },
    ],
  };
  try {
    const delayed = await evaluate(
      `(async()=>{const q=${queueExpression};const id=await q.submit(${JSON.stringify(spec)});return q.records.find(r=>r.id===id)})()`,
    );
    assert.equal(delayed.success, 2);
    assert.equal(delayed.status, '已完成');
    assert.equal(await guest(first, 'fixture.receiptProof.count'), 2);
    await guest(
      first,
      `fixture.receiptProof.mode='pending-first';fixture.receiptProof.count=0;true`,
    );
    const pending = await evaluate(
      `(async()=>{const q=${queueExpression};const id=await q.submit(${JSON.stringify(spec)});return q.records.find(r=>r.id===id)})()`,
    );
    assert.equal(pending.status, '待确认');
    assert.equal(pending.success, 1);
    assert.deepEqual(
      pending.deliveries.map(d => d.status),
      ['uncertain', 'sent'],
    );
    assert.equal(
      await guest(first, 'fixture.receiptProof.count'),
      2,
      'the uncertain message is not sent again',
    );
    console.log(
      'PASS actual bulk runtime: delayed native ACK resolves to success; settled pending IDs honor continue policy with no resend and retain history',
    );
  } finally {
    await guest(
      first,
      `(()=>{const p=fixture.receiptProof;p.sender.addAndSendMsgToChat=p.oldSend;if(p.oldStore===undefined)delete p.collections.Msg;else p.collections.Msg=p.oldStore;delete fixture.receiptProof;return true})()`,
    );
    await evaluate(
      `${queueExpression}.remove(${queueExpression}.records.filter(r=>!${JSON.stringify(before)}.includes(r.id)).map(r=>r.id))`,
    );
  }
}
