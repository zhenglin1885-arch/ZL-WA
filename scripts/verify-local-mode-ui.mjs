/* eslint-disable no-console -- Standalone GUI regression. */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, wait, call, socket } from './account-tools-cdp.mjs';

const restore = process.argv.includes('--restart');
const manifestPath = '/tmp/zl-local-mode-qa-state.json';
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
try {
  await wait(
    '!!window.ferdium?.stores?.user.localSessionReady && window.ferdium.stores.services.allServicesRequest.wasExecuted',
    'automatic local startup',
  );
  const profile = await evaluate(
    `require('@electron/remote').app.getPath('userData')`,
  );
  assert(
    profile.startsWith('/tmp/zl-wa-local-mode-qa/'),
    'Use the isolated local-mode QA profile',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.settings.app.server'),
    'You are using Ferdium without a server',
  );
  assert(!(await evaluate(`document.body.innerText.includes('登录 / 注册')`)));
  await vm(
    `globalThis.__localQARequests=[];globalThis.__localQAFetch=globalThis.fetch;globalThis.fetch=async function(url,...args){globalThis.__localQARequests.push(String(url));if(/^https?:/.test(String(url)) && !['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('QA denies external network');return globalThis.__localQAFetch.call(this,url,...args)};process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{globalThis.__localQARequests.push(details.url);const url=new URL(details.url);callback({cancel:/^https?:/.test(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname)})});true`,
  );
  await evaluate(
    `require('mobx-localstorage').default.setItem('authToken','stale-cloud-token');globalThis.__beforeLocalReload=true;true`,
  );
  await call('Page.reload');
  await new Promise(resolve => {
    setTimeout(resolve, 400);
  });
  await wait(
    '!globalThis.__beforeLocalReload && !!window.ferdium?.stores?.user.localSessionReady && window.ferdium.stores.services.allServicesRequest.wasExecuted',
    'local login without external network',
  );
  assert.notEqual(
    await evaluate('window.ferdium.stores.user.authToken'),
    'stale-cloud-token',
  );
  console.log(
    'PASS fresh startup/reload obtains a local session without cloud login',
  );
  const catalogue = await evaluate(
    `(async()=>{const list=await window.ferdium.api.recipePreviews.all();return list.map(r=>({id:r.id,icon:r.icons.svg}))})()`,
  );
  assert(catalogue.length > 400);
  assert(catalogue.every(r => !/^https?:/.test(r.icon)));
  const results = await evaluate(
    `window.ferdium.api.recipePreviews.search('whatsapp')`,
  );
  assert(results.some(r => r.id === 'whatsapp'));
  await evaluate(`window.ferdium.stores.router.push('/settings/recipes');true`);
  await wait(
    `document.querySelectorAll('.recipe-teaser').length>0`,
    'local services catalogue',
  );
  await evaluate(
    `window.ferdium.stores.router.push('/settings/services');true`,
  );
  await wait(
    `!!document.querySelector('.settings-navigation')`,
    'local settings',
  );
  const navigation = await evaluate(
    `document.querySelector('.settings-navigation').innerText`,
  );
  assert(navigation.includes('本地模式'));
  assert(
    !(await evaluate(
      `!!document.querySelector('.settings-navigation [href="#/settings/user"],.settings-navigation [href="#/settings/team"]')`,
    )),
  );
  await evaluate(`window.ferdium.stores.router.push('/auth/server');true`);
  await wait(
    `window.ferdium.stores.router.location.pathname==='/'`,
    'cloud route redirect',
  );
  console.log(
    'PASS bundled catalogue/search/icons work offline; cloud account and server routes removed',
  );
  if (restore) {
    const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert(
      await evaluate(
        `!!window.ferdium.stores.services.one(${JSON.stringify(expected.id)})`,
      ),
    );
    assert.equal(
      await evaluate(
        `window.ferdium.stores.settings.app.accountSidebar.accounts[${JSON.stringify(expected.id)}].remark`,
      ),
      'Local retained remark',
    );
    const workspaces = await evaluate(
      `require('./features/workspaces/api').workspaceApi.getUserWorkspaces()`,
    );
    assert(workspaces.some(w => w.id === expected.workspaceId));
    console.log(
      'PASS old cloud server setting is migrated; original account ID, remark, group and workspace survive restart',
    );
  } else {
    assert.equal(
      await evaluate('window.ferdium.stores.services.all.length'),
      0,
    );
    await evaluate(
      `window.ferdium.stores.services._createService({recipeId:'whatsapp',serviceData:{name:'Local retained account',isEnabled:false},redirect:false})`,
    );
    const id = await evaluate(
      `window.ferdium.stores.services.all.find(s=>s.name==='Local retained account').id`,
    );
    await evaluate(
      `window.ferdium.actions.settings.update({type:'app',data:{accountSidebar:{groups:[{id:'default',name:'默认分组',collapsed:false},{id:'qa-local',name:'Local retained group',collapsed:true}],accounts:{[${JSON.stringify(id)}]:{groupId:'qa-local',remark:'Local retained remark'}}}}});true`,
    );
    const workspace = await evaluate(
      `require('./features/workspaces/api').workspaceApi.createWorkspace('Local retained workspace')`,
    );
    writeFileSync(
      manifestPath,
      JSON.stringify({ id, workspaceId: workspace.id, profile }),
    );
    console.log(
      'PASS local service install/create and workspace creation need no upstream server',
    );
  }
  const requests = await vm('globalThis.__localQARequests');
  assert(
    !requests.some(url =>
      /https?:\/\/[^/]*(?:api\.ferdium\.org|franzinfra\.com|debug\.ferdium\.org|jsdelivr\.net)/.test(
        url,
      ),
    ),
    JSON.stringify(requests),
  );
  console.log(
    'PASS no requests to upstream account/catalogue/diagnostic or recipe CDN servers during tested flows',
  );
} finally {
  await vm(
    `if(globalThis.__localQAFetch)globalThis.fetch=globalThis.__localQAFetch;process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.defaultSession.webRequest.onBeforeRequest(null);true`,
  ).catch(() => {});
  socket.close();
}
