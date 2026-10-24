/* eslint-disable no-console, no-await-in-loop -- Isolated native Electron startup and storage regression. */
const {
  app,
  BrowserWindow,
  session,
  dialog,
  webContents,
} = require('electron');
const { join } = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = process.env.ZL_CACHE_RECOVERY_ROOT;
const phase = process.env.ZL_CACHE_RECOVERY_PHASE;
const profile = join(root, 'profile');
const installation = join(root, 'Software', 'ZL-WA');
const CacheLocation = require('../../build/electron/CacheLocation').default;

app.setName('ZL-WA-Cache-Recovery-QA');
app.setPath('userData', profile);

if (phase.startsWith('boot-')) {
  dialog.showErrorBox = (title, content) => {
    console.error(title, content);
    app.exit(1);
  };
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', async () => {
      try {
        // Let the real local database finish booting before shutting down Electron.
        const deadline = Date.now() + 30_000;
        while (
          !(await window.webContents.executeJavaScript(
            'Boolean(window.ferdium?.stores?.settings.loaded && window.ferdium.stores.services.allServicesRequest.wasExecuted && !window.ferdium.stores.services.allServicesRequest.isWaitingForResponse)',
          ))
        ) {
          if (Date.now() > deadline)
            throw new Error('Application stores did not finish loading');
          await new Promise(resolve => {
            setTimeout(resolve, 100);
          });
        }
        const config = JSON.parse(
          fs.readFileSync(join(profile, 'cache-location.json'), 'utf8'),
        );
        assert.equal(app.getPath('sessionData'), config.active);
        const browser = session.fromPartition('persist:cache-recovery-account');
        assert(browser.getStoragePath().startsWith(config.active));
        const cookies = await browser.cookies.get({ name: 'login' });
        assert.equal(
          cookies[0]?.value,
          phase === 'boot-restored' ? 'original-login' : undefined,
        );
        console.log(`PASS real application ${phase}`);
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  });
  // eslint-disable-next-line global-require -- Exercise the real normal startup after repairing configuration.
  require('../../build/index.js');
} else if (['restore', 'cancel', 'fresh'].includes(phase)) {
  let restarted = false;
  const responses =
    phase === 'restore' ? [1] : phase === 'fresh' ? [2, 1] : [3];
  dialog.showMessageBox = async () => {
    assert.equal(
      BrowserWindow.getAllWindows().length,
      0,
      'no main window before recovery',
    );
    assert.equal(
      webContents.getAllWebContents().length,
      0,
      'no account page before recovery',
    );
    assert(responses.length, 'unexpected recovery dialog');
    return { response: responses.shift(), checkboxChecked: false };
  };
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [join(root, phase === 'fresh' ? 'safe' : 'restored')],
  });
  dialog.showErrorBox = (title, content) => {
    throw new Error(`${title}: ${content}`);
  };
  app.relaunch = () => {
    restarted = true;
  };
  const exit = app.exit.bind(app);
  app.exit = code => {
    assert.equal(restarted, phase !== 'cancel');
    fs.writeFileSync(
      join(root, `${phase}.json`),
      JSON.stringify({
        restarted,
        windows: BrowserWindow.getAllWindows().length,
        contents: webContents.getAllWebContents().length,
        code,
      }),
    );
    exit(code);
  };
  // eslint-disable-next-line global-require -- Install native dialog hooks before loading the real application.
  require('../../build/index.js');
} else {
  const location = new CacheLocation(profile);
  app.setPath('sessionData', location.initialize());
  app.whenReady().then(async () => {
    try {
      const browser = session.fromPartition('persist:cache-recovery-account');
      assert(browser.getStoragePath().startsWith(app.getPath('sessionData')));
      const window = new BrowserWindow({
        show: false,
        webPreferences: { session: browser },
      });
      await window.loadFile(join(root, 'fixture.html'));
      if (phase === 'seed') {
        await browser.cookies.set({
          url: 'https://example.test',
          name: 'login',
          value: 'original-login',
          expirationDate: Date.now() / 1000 + 3600,
        });
        await window.webContents.executeJavaScript(
          `localStorage.setItem('owner','original-account');new Promise((resolve,reject)=>{const request=indexedDB.open('messages',1);request.onupgradeneeded=()=>request.result.createObjectStore('chats');request.onsuccess=()=>{const db=request.result;const t=db.transaction('chats','readwrite');t.objectStore('chats').put('original-message','message');t.oncomplete=()=>{db.close();resolve(true)};t.onerror=reject};request.onerror=reject})`,
        );
        await browser.cookies.flushStore();
        browser.flushStorageData();
        location.select(join(installation, 'AppData'));
      } else if (phase === 'fresh-verify') {
        const cookies = await browser.cookies.get({ name: 'login' });
        assert.equal(cookies.length, 0);
        assert.equal(
          await window.webContents.executeJavaScript(
            `localStorage.getItem('owner')`,
          ),
          null,
        );
      } else {
        const cookies = await browser.cookies.get({ name: 'login' });
        assert.equal(cookies[0]?.value, 'original-login');
        assert.equal(
          await window.webContents.executeJavaScript(
            `localStorage.getItem('owner')`,
          ),
          'original-account',
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            `new Promise((resolve,reject)=>{const request=indexedDB.open('messages',1);request.onsuccess=()=>{const db=request.result;const q=db.transaction('chats').objectStore('chats').get('message');q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=reject};request.onerror=reject})`,
          ),
          'original-message',
        );
      }
      window.destroy();
      console.log(
        `PASS native Electron ${phase}: ${app.getPath('sessionData')}`,
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
