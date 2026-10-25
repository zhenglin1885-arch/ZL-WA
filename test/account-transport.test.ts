/* eslint-disable unicorn/prefer-event-target -- Electron net.request uses EventEmitter listeners. */
/* eslint-disable global-require -- Install the Electron mock before loading its transport. */
import { EventEmitter } from 'node:events';
import { defaultTools } from '../src/features/accountTools/config';

let request: any;
jest.mock('electron', () => ({ net: { request: jest.fn(() => request) } }));
const { accountTransport } = require('../src/electron/accountTransport');

beforeEach(() => {
  request = new EventEmitter();
  request.setHeader = jest.fn();
  request.write = jest.fn();
  request.abort = jest.fn();
  request.end = jest.fn();
});
it('uses the account Session for direct and SOCKS bridge requests', async () => {
  const s: any = { fetch: jest.fn().mockResolvedValue(new Response('ok')) };
  await accountTransport(
    s,
    defaultTools().proxy,
    () => '',
  )('https://example.invalid', {});
  expect(s.fetch).toHaveBeenCalledWith('https://example.invalid', {
    bypassCustomProtocolHandlers: true,
  });
});
it('answers only the exact account HTTP proxy challenge once, never origin authentication', async () => {
  const s: any = {};
  const proxy = {
    ...defaultTools().proxy,
    enabled: true,
    host: 'proxy.invalid',
    port: '8080',
    username: 'synthetic-user',
  };
  const transport = accountTransport(s, proxy, () => 'synthetic-secret');
  const result = transport('https://provider.invalid/translate', {
    method: 'POST',
    body: 'synthetic-body',
  });
  const callback = jest.fn();
  request.emit(
    'login',
    { isProxy: false, host: 'proxy.invalid', port: 8080 },
    callback,
  );
  expect(callback).toHaveBeenLastCalledWith();
  request.emit(
    'login',
    { isProxy: true, host: 'another.invalid', port: 8080 },
    callback,
  );
  expect(callback).toHaveBeenLastCalledWith();
  request.emit(
    'login',
    { isProxy: true, host: 'proxy.invalid', port: 8080 },
    callback,
  );
  expect(callback).toHaveBeenLastCalledWith(
    'synthetic-user',
    'synthetic-secret',
  );
  request.emit(
    'login',
    { isProxy: true, host: 'proxy.invalid', port: 8080 },
    callback,
  );
  expect(callback).toHaveBeenLastCalledWith();
  const response: any = new EventEmitter();
  response.statusCode = 200;
  response.headers = { 'retry-after': ['45'] };
  request.emit('response', response);
  response.emit('data', Buffer.from('translated'));
  response.emit('end');
  const translated = await result;
  expect(await translated.text()).toBe('translated');
  expect(translated.headers.get('retry-after')).toBe('45');
  expect(require('electron').net.request).toHaveBeenLastCalledWith(
    expect.objectContaining({ session: s, redirect: 'error' }),
  );
});
it('aborts the underlying account request on timeout/cancellation', async () => {
  const controller = new AbortController();
  const s: any = {};
  const promise = accountTransport(
    s,
    {
      ...defaultTools().proxy,
      enabled: true,
      host: 'proxy.invalid',
      port: '8080',
      username: 'user',
    },
    () => '',
  )('https://provider.invalid', { signal: controller.signal });
  controller.abort();
  await expect(promise).rejects.toThrow('已取消');
  expect(request.abort).toHaveBeenCalledTimes(1);
});
