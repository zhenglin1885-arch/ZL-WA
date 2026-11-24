import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Probe } from '../backend.mjs';
function fixture(options = {}) {
  const sockets = [], updates = [], timers = []; let saves = 0, calls = 0;
  const probe = new Probe({ auth: async () => ({ state: { creds: {} }, saveCreds: async () => { saves++; } }),
    makeSocket: config => { const sock = { ev: new EventEmitter(), end() {}, async sendMessage() { calls++; return { key: { id: 'private-id' } }; } }; sockets.push(sock); return sock; },
    emit: state => updates.push(state), qrImage: async () => 'data:image/png;base64,secret-qr',
    timer: fn => { timers.push(fn); return fn; }, cancel: fn => timers.splice(timers.indexOf(fn),1), ...options });
  return { probe, sockets, updates, timers, saves: () => saves, calls: () => calls };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('start is idempotent; QR and open are distinct states', async () => {
  const f = fixture(); await Promise.all([f.probe.start(), f.probe.start()]); assert.equal(f.sockets.length, 1);
  f.sockets[0].ev.emit('connection.update', { qr: 'secret' }); await tick(); assert.equal(f.probe.state.status, 'qr');
  f.sockets[0].ev.emit('connection.update', { connection: 'open' }); assert.equal(f.probe.state.status, 'connected'); assert.equal(f.probe.state.qr, null);
});
test('late QR encoder cannot overwrite connected state or stopped generation', async () => {
  let done; const f = fixture({ qrImage: () => new Promise(resolve => { done = resolve; }) }); await f.probe.start();
  f.sockets[0].ev.emit('connection.update', { qr: 'secret' }); f.sockets[0].ev.emit('connection.update', { connection: 'open' }); done('secret'); await tick(); assert.equal(f.probe.state.qr, null);
  f.probe.stop(); f.sockets[0].ev.emit('connection.update', { connection: 'open' }); assert.equal(f.probe.state.status, 'stopped');
});
test('logout and conflict never retry or delete auth', async () => {
  for (const statusCode of [401,440,403,411,500]) { const f = fixture(); await f.probe.start(); f.sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } }); assert.equal(f.timers.length,0); assert.equal(f.probe.running,false); }
});
test('pairing restart saves credentials before reconnect and caps retries', async () => {
  const f = fixture(); await f.probe.start();
  for (let i=0;i<4;i++) { const sock = f.sockets.at(-1); sock.ev.emit('creds.update', {}); sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } }); if (i<3) { f.timers.shift()(); await tick(); } }
  await f.probe.saves; assert.equal(f.sockets.length,4); assert.equal(f.saves(),4); assert.equal(f.probe.running,false);
});
test('failed credential save stops connection', async () => {
  const f = fixture({ auth: async () => ({ state:{}, saveCreds: async () => { throw Error('secret'); } }) }); await f.probe.start(); f.sockets[0].ev.emit('creds.update'); await tick(); assert.equal(f.probe.state.status,'storage-error'); assert.equal(f.probe.running,false);
});
test('send requires connection and valid inputs; never retries uncertain sends', async () => {
  const f = fixture(); await assert.rejects(f.probe.send('+5511999999999','hi'),/NOT_CONNECTED/); await f.probe.start(); f.sockets[0].ev.emit('connection.update',{connection:'open'});
  await assert.rejects(f.probe.send('bad','hi'),/INVALID_NUMBER/); await assert.rejects(f.probe.send('+5511999999999',''),/INVALID_TEXT/);
  await f.probe.send('+5511999999999','hi'); assert.equal(f.calls(),1);
  let failedCalls=0; f.sockets[0].sendMessage=async()=>{failedCalls++;throw Error('secret');};
  await assert.rejects(f.probe.send('+5511999999999','hi'),/SEND_UNCONFIRMED/); assert.equal(failedCalls,1);
});
test('receive and sync are separate; diagnostics exclude QR, JIDs and message body', async () => {
  const f=fixture(); await f.probe.start(); const ev=f.sockets[0].ev;
  ev.emit('connection.update',{qr:'secret-qr'}); await tick();
  ev.emit('messaging-history.set',{chats:[{id:'private-jid'}]});
  ev.emit('messages.upsert',{type:'notify',messages:[{key:{remoteJid:'private-jid'},message:{conversation:'private-body'}}]});
  assert.equal(f.probe.state.received,1); assert.equal(f.probe.state.syncEvents,1);
  const out=JSON.stringify(f.probe.diagnostics()); for(const secret of ['secret-qr','private-jid','private-body']) assert.equal(out.includes(secret),false);
});
test('stop cancels delayed reconnection', async()=>{
  const f=fixture();await f.probe.start();f.sockets[0].ev.emit('connection.update',{connection:'close'}); const retry=f.timers[0]; f.probe.stop();retry();await tick();assert.equal(f.sockets.length,1);
});
