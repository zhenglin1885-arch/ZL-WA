import type { ProtocolState } from '../src/features/protocol/types';
jest.mock('electron', () => {
  const { EventEmitter } = require('node:events');
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = jest.fn(async () => undefined);
  return { ipcRenderer };
});
const { ipcRenderer } = jest.requireMock('electron');
const {
  protocolStates,
  subscribeProtocol,
} = require('../src/features/protocol/client');
const owner = '5511999999999@c.us';
const state = (): ProtocolState => ({
  status: 'connected',
  qr: null,
  syncEvents: 1,
  nickname: 'Actual account',
  ownerId: owner,
  ownerIds: [owner],
  phone: '5511999999999',
  error: '',
  chats: [],
});
const account = (id: string): any => ({
  id,
  isProtocol: true,
  isEnabled: true,
  isHibernating: false,
  accountSnapshot: { status: 'loading' },
  hasCrashed: false,
});
beforeEach(() => {
  protocolStates.clear();
  ipcRenderer.invoke.mockClear();
});
it('marks an account online only from its live protocol event and uses the actual account nickname', () => {
  const service = account('client-one');
  const listener = jest.fn();
  const stop = subscribeProtocol(service, listener);
  expect(service.accountSnapshot.status).toBe('loading');
  ipcRenderer.emit('protocol-state', {}, service.id, state());
  expect(service.accountSnapshot).toMatchObject({
    status: 'online',
    nickname: 'Actual account',
    ownerId: owner,
  });
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
});
it('unmounting clears cached online state and prevents a later event from resurrecting the account', () => {
  const service = account('client-two');
  const stop = subscribeProtocol(service, jest.fn());
  ipcRenderer.emit('protocol-state', {}, service.id, state());
  stop();
  expect(service.accountSnapshot.status).toBe('loading');
  expect(protocolStates.has(service.id)).toBe(false);
  ipcRenderer.emit('protocol-state', {}, service.id, state());
  expect(service.accountSnapshot.status).toBe('loading');
});
it('a cached previous connected state is presented as reconnecting rather than live online', () => {
  const service = account('client-three');
  protocolStates.set(service.id, state());
  const stop = subscribeProtocol(service, jest.fn());
  expect(service.accountSnapshot.status).toBe('loading');
  stop();
});
it('a newly confirmed different owner does not inherit the old avatar or phone', () => {
  const service = account('client-four');
  service.accountSnapshot = {
    status: 'loading',
    ownerId: '5511777777777@c.us',
    nickname: 'Old',
    avatar: 'old-avatar',
    phone: '5511777777777',
  };
  const stop = subscribeProtocol(service, jest.fn());
  ipcRenderer.emit('protocol-state', {}, service.id, state());
  expect(service.accountSnapshot.ownerId).toBe(owner);
  expect(service.accountSnapshot.phone).toBe('5511999999999');
  expect(service.accountSnapshot.avatar).toBeUndefined();
  stop();
});
