/* eslint-disable no-await-in-loop -- Native dialog/theme checks are sequential and depend on prior state. */
import assert from 'node:assert/strict';

// Exercise the distributed app through its own renderer, using an empty profile.
// This never creates accounts or sends requests to WhatsApp.
export async function verifyPackagedTools(evaluate) {
  const waitFor = async (expression, name) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });
    }
    throw new Error(`Packaged interface did not become ready: ${name}`);
  };
  await waitFor('!!document.querySelector(".account-tools-rail")', 'tool rail');
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.length'),
    0,
    'packaged checks require an empty isolated profile',
  );
  const theme = await evaluate(
    '(()=>{const a=window.ferdium.stores.settings.app;return {darkMode:a.darkMode,adaptableDarkMode:a.adaptableDarkMode}})()',
  );
  await evaluate(
    `(()=>{window.__zlPackagedInterfaceErrors=[];window.addEventListener('error',e=>window.__zlPackagedInterfaceErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__zlPackagedInterfaceErrors.push(String(e.reason)));return true})()`,
  );
  const cases = [];
  try {
    for (const dark of [false, true]) {
      await evaluate(
        `window.ferdium.stores.settings._update({type:'app',data:{darkMode:${dark},adaptableDarkMode:false}})`,
      );
      await waitFor(
        `document.body.classList.contains('theme__dark')===${dark}`,
        'theme',
      );
      for (const label of ['群发', '群组', '进群', '退群', '点赞', '回复']) {
        await evaluate(
          `(()=>{const b=[...document.querySelectorAll('.account-tools-rail button')].find(n=>n.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing enabled tool');b.click();return true})()`,
        );
        await waitFor(
          '!!document.querySelector(".account-tools-dialog .MuiPaper-root")',
          label,
        );
        if (label === '群发') {
          await waitFor(
            '!!document.querySelector(".bulk-history")',
            'send records',
          );
          await evaluate(
            'document.querySelector(".bulk-dialog__header-actions button").click();true',
          );
          await waitFor('!!document.querySelector(".bulk-columns")', 'compose');
        }
        const state = await evaluate(
          `(()=>{const d=document.querySelector('.account-tools-dialog');const p=d.querySelector('.MuiPaper-root');const s=getComputedStyle(p);const n=d.querySelector('.bulk-dialog__close-icon,.group-tools-close');const r=n.getBoundingClientRect();return {scheme:getComputedStyle(d).colorScheme,background:s.backgroundColor,closeVisible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight,errorFallback:!!document.querySelector('[role="alert"] h1')}})()`,
        );
        assert.equal(state.scheme, dark ? 'dark' : 'light');
        assert.equal(
          state.background,
          dark ? 'rgb(29, 31, 31)' : 'rgb(255, 255, 255)',
        );
        assert(state.closeVisible && !state.errorFallback, label);
        cases.push({ label, dark, ...state });
        await evaluate(
          'document.querySelector(".account-tools-dialog .bulk-dialog__close-icon,.account-tools-dialog .group-tools-close").click();true',
        );
        await waitFor(
          '!document.querySelector(".account-tools-dialog")',
          'close',
        );
      }
    }
    const errors = await evaluate('window.__zlPackagedInterfaceErrors');
    assert.deepEqual(
      errors,
      [],
      'packaged tools must not throw renderer errors',
    );
    return { dialogsAndThemesVerified: true, cases, uncaughtRendererErrors: 0 };
  } finally {
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(theme)}})`,
    );
  }
}
