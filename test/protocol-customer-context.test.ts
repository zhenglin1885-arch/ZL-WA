export {};
jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
const { ipcRenderer } = jest.requireMock('electron');
const { CustomerRuntime } = require('../src/features/customers/runtime');
const {
  protocolStates,
  protocolChats,
} = require('../src/features/protocol/client');
const owner = '5511999999999@c.us',
  first = '5511888888888@c.us',
  second = '123456789012345@lid';
const bundle = {
  owner,
  ownerAliases: [owner],
  revision: 1,
  summaries: {},
  aliases: {},
  pins: [],
};
function fixture() {
  const service = {
    id: 'protocol-context',
    isProtocol: true,
    recipe: { id: 'whatsapp' },
    isEnabled: true,
    isHibernating: false,
    accountSnapshot: { status: 'online', ownerId: owner },
  };
  protocolStates.set(service.id, {
    ownerId: owner,
    ownerIds: [owner],
    chats: [
      { id: first, name: 'First', group: false },
      { id: second, name: 'Second', group: false },
    ],
  });
  protocolChats.set(service.id, first);
  return {
    service,
    runtime: new CustomerRuntime({ services: { active: service } }),
  };
}
beforeEach(() => {
  protocolStates.clear();
  protocolChats.clear();
  ipcRenderer.invoke.mockReset();
});
it('does not expose or adopt the previous customer while a stale alias request completes after a chat switch', async () => {
  const { service, runtime } = fixture();
  let finish: (value: string[]) => void = () => {};
  ipcRenderer.invoke.mockImplementation(async (channel: string) =>
    channel === 'protocol-request'
      ? new Promise(resolve => {
          finish = resolve;
        })
      : bundle,
  );
  const pending = runtime.refresh();
  protocolChats.set(service.id, second);
  expect(runtime.current).toBeUndefined();
  finish([first]);
  await pending;
  expect(runtime.current).toBeUndefined();
  ipcRenderer.invoke.mockImplementation(
    async (channel: string, _id: string, _action: string, args: any) =>
      channel === 'protocol-request' ? [args.jid] : bundle,
  );
  await runtime.refresh();
  expect(runtime.current.chat.id).toBe(second);
});
it('keeps the currently selected customer usable when the optional LID alias lookup is unavailable', async () => {
  const { service, runtime } = fixture();
  protocolChats.set(service.id, second);
  ipcRenderer.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'protocol-request') throw Error('mapping not ready');
    return bundle;
  });
  await runtime.refresh();
  expect(runtime.current.chat.id).toBe(second);
  expect(runtime.current.chat.aliases).toEqual([second]);
  service.accountSnapshot.status = 'logged-out';
  expect(runtime.current).toBeUndefined();
});
