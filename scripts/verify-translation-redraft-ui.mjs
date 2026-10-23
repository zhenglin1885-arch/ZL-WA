/* eslint-disable no-await-in-loop -- Each action verifies the preceding native editor event. */
/* eslint-disable no-console -- GUI regression status. */
import assert from 'node:assert/strict';

export async function verifyTranslationRedraft({
  first,
  guest,
  evaluate,
  wait,
  service,
}) {
  const originalSent = await guest(first, 'fixture.sent.slice()');
  const view = `${service(first)}.webview`;
  const key = async (keyCode, modifiers = []) => {
    await evaluate(
      `(async()=>{const v=${view};await v.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});await v.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});return true})()`,
    );
  };
  const focus = async () => {
    await evaluate(`${view}.focus()`);
    await guest(
      first,
      `document.querySelector('#main footer [contenteditable]').focus();true`,
    );
  };
  const ready = async () => {
    await wait(
      `${view}.executeJavaScript('Boolean(window.__zlTranslation.approved)&&!window.__zlTranslation.busy')`,
      'redraft translated preview',
    );
  };
  const send = async () =>
    guest(first, `document.querySelector('footer button').click();true`);
  let sent = originalSent.length;
  try {
    for (const clearFirst of [true, false]) {
      await guest(
        first,
        `document.querySelector('#main footer [contenteditable]').textContent='重新输入前测试${clearFirst}';document.querySelector('footer button').click();true`,
      );
      await ready();
      await focus();
      await key('A', ['control']);
      if (clearFirst) {
        await key('Backspace');
        assert.equal(await guest(first, 'fixture.editorText()'), '');
        assert.equal(
          await guest(first, 'Boolean(window.__zlTranslation.approved)'),
          false,
        );
      }
      const text = clearFirst
        ? '清空译文之后的新消息'
        : '全选后直接替换的新消息';
      await evaluate(`${view}.insertText(${JSON.stringify(text)})`);
      assert.equal(await guest(first, 'fixture.editorText()'), text);
      assert.equal(
        await guest(first, 'Boolean(window.__zlTranslation.approved)'),
        false,
        'new draft cannot inherit the previous translation approval',
      );
      await (clearFirst ? send() : key('Enter'));
      assert.equal(
        await guest(first, 'fixture.sent.length'),
        sent,
        'new original text stays unsent',
      );
      await ready();
      assert.equal(
        await guest(first, 'fixture.editorText()'),
        'Hello translated',
      );
      await send();
      sent += 1;
      assert.equal(
        await guest(first, 'fixture.sent.at(-1)'),
        'Hello translated',
      );
      assert.equal(await guest(first, 'fixture.sent.length'), sent);
    }
    // A partial native correction remains a correction, not a new draft.
    await guest(
      first,
      `document.querySelector('#main footer [contenteditable]').textContent='校正测试';document.querySelector('footer button').click();true`,
    );
    await ready();
    await focus();
    await key('End', ['control']);
    await evaluate(`${view}.insertText(' corrected')`);
    assert.equal(
      await guest(first, 'Boolean(window.__zlTranslation.approved)'),
      true,
    );
    await send();
    assert.equal(
      await guest(first, 'fixture.sent.at(-1)'),
      'Hello translated corrected',
    );
    console.log(
      'PASS native clear/retype and whole-draft replacement retranslate before click/Enter sends; partial corrections still send on confirmation',
    );
  } finally {
    await guest(first, `fixture.sent=${JSON.stringify(originalSent)};true`);
  }
}
