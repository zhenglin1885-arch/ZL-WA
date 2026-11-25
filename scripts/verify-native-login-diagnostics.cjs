/* Compiled guest observation in real Electron, using public native event definitions.
 * This verifies observation, not real phone authentication. */
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { app, BrowserWindow, session } = require('electron');
app.setPath(
  'userData',
  mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'zl-native-login-'),
  ),
);
const {
  configureNativeConnection,
} = require('../build/features/accounts/nativeConnection.js');
const {
  readSendDiagnostics,
} = require('../build/features/accounts/sendDiagnostics.js');
const registrationStages = JSON.parse(
  readFileSync(
    require('node:path').join(
      __dirname,
      '../test/fixtures/whatsapp-registration-stages.json',
    ),
    'utf8',
  ),
);
const fixtures = JSON.parse(
  readFileSync(
    require('node:path').join(
      __dirname,
      '../test/fixtures/whatsapp-native-link-events.json',
    ),
    'utf8',
  ),
);
app
  .whenReady()
  .then(async () => {
    const s = session.fromPartition(
      'qa-native-login-diagnostics-' + Date.now(),
    );
    await s.protocol.handle(
      'https',
      () =>
        new Response(
          '<!doctype html><html><body><div data-testid="qrcode"><canvas></canvas></div></body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        ),
    );
    const win = new BrowserWindow({
      show: false,
      webPreferences: { session: s },
    });
    try {
      await win.loadURL('https://web.whatsapp.com/login/');
      const result = await win.webContents.executeJavaScript(`(async()=>{
      const original={fetch,ws:WebSocket,get:navigator.credentials.get,open:indexedDB.open,start:performance.timeOrigin};
      function E(){this.events=new Map()}
      E.prototype.on=function(k,fn){const a=this.events.get(k)||[];a.push(fn);this.events.set(k,a);return this};
      E.prototype.off=function(k,fn){this.events.set(k,(this.events.get(k)||[]).filter(f=>f!==fn));return this};
      E.prototype.trigger=function(k,...args){for(const fn of [...(this.events.get(k)||[])])fn(...args)};
      const modules={};const exports={};
      const babelHelpers={inheritsLoose(c,p){c.prototype=Object.create(p.prototype);c.prototype.constructor=c;Object.setPrototypeOf(c,p)}};
      function __d(name,deps,factory){const out={};factory(window,()=>{},n=>modules[n]?.exports?.default||modules[n]?.exports||E,n=>modules[n]?.exports?.default||modules[n]?.exports||E,{},out,out);modules[name]={isInitialized:true,exports:out};exports[name]=out}
      ${fixtures.WAWebLinkDeviceEvents.definition}
      ${fixtures.WASocketCloseReason.definition}
      ${fixtures.WAWebAppCommsCloseReason.definition}
      E.prototype.addListener=function(k,fn){this.on(k,fn);return {remove:()=>this.off(k,fn)}};
      E.prototype.emit=E.prototype.trigger;
      modules.ODS={exports:{bumpEntityKey(){},flush(){}}};
      ${fixtures.WAWebODSObserver.definition}
      ${fixtures.WAWebODSImpl.definition}
      const bus=Object.assign(new E(),{socketState:'PAIRING',isMainStreamReadyMd:false});
      modules.WAWebBackendEventBus={isInitialized:true,exports:{BackendEventBus:bus}};
      window.require=name=>name==='__debug'?{modulesMap:modules}:modules[name]?.exports;
      const host=[];window.ferdium={pushWhatsAppConnectionEvent:e=>host.push(e)};
      (${configureNativeConnection.toString()})();
      const observer=exports.WAWebODSObserver.default;
      for(const key of Object.keys(${JSON.stringify(registrationStages)}))exports.WAWebODSImpl.default.incr(key);
      observer.emit('event',Object.defineProperty({},'key',{get(){throw Error('Private getter called')}}));
      const registrationDiagnostic=(${readSendDiagnostics.toString()})();
      window.__zlWaNativeConnection.trace.length=0;
      const links=exports.WAWebLinkDeviceEvents.WAWebLinkDeviceEvents;
      links.triggerPasskeyPrologueRequest();links.triggerShortcakePrologueSent();
      const secret=new Proxy({},{get(){throw Error('Private pairing argument inspected')}});
      links.triggerShortcakeVerificationCodeReady(secret,secret);
      links.triggerShortcakeError(new DOMException('PRIVATE_CHALLENGE','NotAllowedError'));
      const surfaceStates = [
        ['present', ''],
        ['prompt', '<div data-testid="shortcake_passkey_prompt_card"></div>'],
        ['pending', '<button data-testid="shortcake_passkey_continue_button" disabled></button>'],
        ['waiting-for-phone', '<div data-testid="shortcake_waiting_for_phone_card"></div>'],
        ['verification', '<div data-testid="shortcake_code_matching_card"><span data-testid="shortcake_verification_code_display">PRIVATE_CODE</span></div>'],
        ['error', '<div data-testid="shortcake_passkey_error_message">PRIVATE_ERROR</div>'],
        ['absent', null],
      ];
      for (const [state, content] of surfaceStates) {
        document.body.innerHTML=content===null ? '' : '<div data-testid="shortcake_passkey_screen">'+content+'</div>';
        await new Promise(resolve=>setTimeout(resolve,600));
        if (window.__zlWaNativeConnection.read().passkeySurface!==state) throw Error('Passkey surface not observed: '+state);
      }
      const reasons=[...Object.values(exports.WASocketCloseReason.CommsCloseReason),...Object.values(exports.WAWebAppCommsCloseReason.AppCommsCloseReason)];
      for(const reason of reasons)bus.trigger('socket_stream_disconnected',reason);
      bus.trigger('socket_stream_disconnected',{reason:'registration_failure',secret:'PRIVATE_TOKEN'});
      bus.trigger('socket_stream_disconnected');
      bus.trigger('socket_stream_disconnected',Object.defineProperty({},'reason',{get(){throw Error('Private getter called')}}));
      bus.trigger('socket_stream_disconnected','PRIVATE_RAW_REASON');
      const diagnostic=(${readSendDiagnostics.toString()})();
      const unchanged=original.fetch===fetch&&original.ws===WebSocket&&original.get===navigator.credentials.get&&original.open===indexedDB.open&&original.start===performance.timeOrigin;
      window.__zlWaNativeConnection.dispose();
      return {diagnostic,registrationDiagnostic,host,reasons,unchanged};
    })()`);
      assert.equal(
        result.registrationDiagnostic.nativeConnection
          .registrationEventsObserved,
        true,
      );
      assert.deepEqual(
        result.registrationDiagnostic.nativeConnection.events
          .filter(e => e.event === 'registration-stage')
          .map(e => e.code),
        Object.values(registrationStages),
      );
      assert.equal(result.unchanged, true);
      assert.equal(result.diagnostic.format, 6);
      assert.equal(result.diagnostic.nativeConnection.linkEventsObserved, true);
      const events = result.diagnostic.nativeConnection.events;
      for (const name of [
        'passkey-request',
        'passkey-prologue-sent',
        'passkey-verification-ready',
      ])
        assert(events.some(e => e.event === name && e.code === null));
      assert(
        events.some(
          e => e.event === 'passkey-error' && e.code === 'NotAllowedError',
        ),
      );
      assert.equal(result.reasons.length, 47);
      for (const code of [
        'present',
        'prompt',
        'pending',
        'waiting-for-phone',
        'verification',
        'error',
        'absent',
      ])
        assert(
          events.some(e => e.event === 'passkey-surface' && e.code === code),
          code,
        );
      for (const reason of result.reasons)
        assert(
          events.some(
            e => e.event === 'socket-disconnected' && e.code === reason,
          ),
          reason,
        );
      assert.equal(events.at(-1).code, null);
      assert(
        events.some(
          e =>
            e.event === 'socket-disconnected' &&
            e.code === 'registration_failure' &&
            e.payloadKind === 'object',
        ),
      );
      assert(
        events.some(
          e =>
            e.event === 'socket-disconnected' &&
            e.code === null &&
            e.payloadKind === 'undefined',
        ),
      );
      assert(!JSON.stringify(result).includes('PRIVATE_'));
      console.log(
        'PASS compiled native observer: all 47 transport/application close categories and four Shortcake events captured; no browser API replacement, reload or private values',
      );
      const build = JSON.parse(
        readFileSync(
          require('node:path').join(__dirname, '../build/buildInfo.json'),
          'utf8',
        ),
      );
      if (process.env.GITHUB_SHA)
        assert(process.env.GITHUB_SHA.startsWith(build.gitHashShort));
      const report = {
        commit: process.env.GITHUB_SHA || build.gitHashShort,
        platform: process.platform,
        officialCloseCategories: result.reasons.length,
        transportCloseCategories: 22,
        applicationCloseCategories: 25,
        structuredClosePayloadVerified: true,
        missingPayloadKindVerified: true,
        passkeyEvents: 4,
        passkeySurfaceStates: 7,
        registrationStages: Object.keys(registrationStages).length,
        registrationObserverVerified: true,
        compiledGuestVerified: true,
        browserApisUnchanged: true,
        realPhonePairingVerified: false,
      };
      if (process.env.ZL_LOGIN_DIAGNOSTICS_REPORT)
        writeFileSync(
          process.env.ZL_LOGIN_DIAGNOSTICS_REPORT,
          JSON.stringify(report, null, 2) + '\n',
        );
      console.log(JSON.stringify(report));
    } finally {
      win.destroy();
      await s.protocol.unhandle('https');
    }
  })
  .then(
    () => app.exit(0),
    error => {
      console.error(error);
      app.exit(1);
    },
  );
