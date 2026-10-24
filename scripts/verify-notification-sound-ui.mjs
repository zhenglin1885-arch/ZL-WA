/* eslint-disable no-console -- GUI regression output. */
import assert from 'node:assert/strict';
import { evaluate, wait, socket } from './account-tools-cdp.mjs';

let muted;
try {
  await wait('window.ferdium?.stores?.settings.loaded', 'settings loaded');
  const duration = await evaluate(
    `new Promise((resolve,reject)=>{const audio=new Audio(new URL('assets/sounds/ding-dong.wav',location.href).href);const timer=setTimeout(()=>reject(Error('Local bell failed to decode')),5000);audio.onloadedmetadata=()=>{clearTimeout(timer);resolve(audio.duration)};audio.onerror=()=>{clearTimeout(timer);reject(Error('Local bell unavailable'))}})`,
  );
  assert(Math.abs(duration - 1.6) < 0.01, 'bundled WAV decodes in Chromium');
  muted = await evaluate(
    'Boolean(window.ferdium.stores.settings.all.app.isAppMuted)',
  );
  await evaluate(
    'window.ferdium.stores.settings._update({type:"app",data:{isAppMuted:false}})',
  );
  const result = await evaluate(`(()=>{
    const play=HTMLMediaElement.prototype.play;const Notification=window.Notification;
    const calls=[];const popups=[];
    HTMLMediaElement.prototype.play=function(){calls.push({src:this.src,volume:this.volume});return Promise.resolve()};
    window.Notification=class{constructor(title,options){popups.push(options)}addEventListener(){}};
    try{
      const app=window.ferdium.stores.app;
      app._notify({title:'QA new message',options:{body:'local'},notificationId:'qa-1',serviceId:'qa'});
      app._notify({title:'QA burst',options:{body:'local'},notificationId:'qa-2',serviceId:'qa'});
      app._notify({title:'QA silent',options:{silent:true},notificationId:'qa-3',serviceId:'qa'});
      app._notify({title:'QA clipboard',options:{},notificationId:'qa-4'});
      return {calls,popups};
    }finally{HTMLMediaElement.prototype.play=play;window.Notification=Notification}
  })()`);
  assert.equal(
    result.calls.length,
    1,
    'one sound per message burst, no sound for silent or clipboard events',
  );
  assert(result.calls[0].src.endsWith('/assets/sounds/ding-dong.wav'));
  assert.equal(result.calls[0].volume, 0.65);
  assert(
    result.popups.every(popup => popup.silent),
    'OS default sound disabled to avoid duplication',
  );
  await evaluate(
    'window.ferdium.stores.settings._update({type:"app",data:{isAppMuted:true}})',
  );
  const quiet = await evaluate(
    `(()=>{const notify=window.Notification;let count=0;window.Notification=class{constructor(){count++}addEventListener(){}};try{window.ferdium.stores.app._notify({title:'muted',options:{},notificationId:'qa-muted',serviceId:'qa'});return count}finally{window.Notification=notify}})()`,
  );
  assert.equal(quiet, 0, 'global mute suppresses notifications and sound');
  console.log(
    'PASS actual app notifications use a bundled ding-dong, coalesce bursts, honor silent/global mute and avoid duplicate OS sounds',
  );
} finally {
  if (muted !== undefined)
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{isAppMuted:${muted}}})`,
    );
  socket.close();
}
