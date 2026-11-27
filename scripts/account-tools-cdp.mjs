/* eslint-disable no-await-in-loop -- Poll until the UI condition becomes true. */
import assert from 'node:assert/strict';

const listing = await fetch(
  `http://127.0.0.1:${process.env.ZL_QA_CDP_PORT || '9222'}/json/list`,
);
const pages = await listing.json();
const page = pages.find(
  p => p.url.startsWith('file://') && p.url.includes('/build/index.html'),
);
assert(page, 'application window exists');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve);
  socket.addEventListener('error', reject);
});
let id = 0;
const pending = new Map();
socket.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(m.error);
    else p.resolve(m.result);
  }
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    id += 1;
    const n = id;
    pending.set(n, { resolve, reject });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      r.exceptionDetails.exception?.description || r.exceptionDetails.text,
    );
  return r.result.value;
};
const wait = async (expression, label) => {
  const end = Date.now() + 18_000;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise(r => {
      setTimeout(r, 80);
    });
  }
  throw new Error(`Timed out: ${label}`);
};
const click = async selector => {
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`, selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
};
// Normalize only presentation additions; functional result/count assertions stay explicit.
const normaliseAction = value =>
  value
    .trim()
    .replace(/^\+\s*/u, '')
    .replace(/（\d+ 个群）$/u, '')
    .trim();
const clickText = async text => {
  await evaluate(
    `(()=>{const wanted=${JSON.stringify(text)};const clean=(${normaliseAction.toString()});const b=[...document.querySelectorAll('button,summary,[role="menuitem"],[role="option"]')].find(n=>clean(n.textContent)===wanted||(wanted==='选择图片附件'&&n.textContent.trim().startsWith('选择图片 ·')));if(!b)throw Error('Missing button '+wanted);b.click()})()`,
  );
};
const fill = async value => {
  await wait(`!!document.querySelector('[role="dialog"] input')`, 'input');
  await evaluate(
    `(()=>{const i=document.querySelector('[role="dialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
};
const save = async () => {
  await clickText('保存');
  await wait(`!document.querySelector('[role="dialog"]')`, 'dialog saved');
};

export { evaluate, wait, click, clickText, fill, save, call, socket };
