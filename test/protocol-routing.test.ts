import { defaultGroupState } from '../src/features/groups/types';
import { bottomUpGroupRecipients } from '../src/features/accountTools/bulkRecipientOrder';
import {
  normalizeAccountConfig,
  serializeAccountConfig,
  updateAccount,
} from '../src/features/accounts/state';
import type { BulkSpec } from '../src/features/accountTools/config';
jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
const { ipcRenderer } = jest.requireMock('electron');
const { getBulkQueue } = require('../src/features/accountTools/bulkRuntime');
const { GroupRuntime } = require('../src/features/groups/runtime');
const owner = '5511999999999@c.us';
const service = () => ({
  id: 'protocol-account',
  isProtocol: true,
  recipe: { id: 'whatsapp' },
  isEnabled: true,
  isHibernating: false,
  accountSnapshot: {
    status: 'online',
    ownerId: owner,
    ownerIds: [owner, '123456789012345@lid'],
  },
  webview: null,
});
const spec = (id: string, count = 4): BulkSpec => ({
  type: 'text',
  text: 'QA',
  typingSeconds: 0,
  intervalMin: 0.5,
  intervalMax: 0.5,
  mentionAll: false,
  failure: 'continue',
  targets: bottomUpGroupRecipients(
    Array.from({ length: count }, (_, index) => ({
      id: `${123456789012340 + index}@g.us`,
      name: String.fromCharCode(65 + index),
      accountId: id,
      ownerId: owner,
      group: true,
    })),
  ),
});
beforeEach(() => {
  ipcRenderer.invoke.mockReset();
  ipcRenderer.invoke.mockImplementation(
    async (channel: string, _id: string, action: string, args: any) => {
      if (channel === 'account-tools-history') return [];
      if (channel === 'account-tools-history-delete') return [];
      if (channel === 'group-tools-load') return defaultGroupState();
      if (channel === 'protocol-request' && action === 'send')
        return { messageId: `sent-${args.jid}`, confirmed: true };
      if (channel === 'protocol-request' && action === 'groups')
        return [
          {
            id: '123456789012345@g.us',
            name: 'Group',
            admin: true,
            announce: false,
          },
        ];
      if (channel === 'protocol-request' && action === 'group-operation')
        return { status: 'success', message: 'Verified' };
      return undefined;
    },
  );
});
it('keeps the same bulk queue and sends selected groups bottom-up through the new backend', async () => {
  const account = service();
  const queue = getBulkQueue({ services: { all: [account] } });
  const id = await queue.submit(spec(account.id));
  const sends = ipcRenderer.invoke.mock.calls.filter(
    (call: any[]) => call[0] === 'protocol-request' && call[2] === 'send',
  );
  expect(sends.map((call: any[]) => call[3].jid)).toEqual(
    spec(account.id).targets.map(target => target.id),
  );
  expect(sends).toHaveLength(4);
  expect(
    sends.every(
      (call: any[]) =>
        call[3].owner === owner &&
        typeof call[3].spec.operationToken === 'string',
    ),
  ).toBe(true);
  expect(queue.records.find((record: any) => record.id === id).success).toBe(4);
  expect(
    ipcRenderer.invoke.mock.calls.some(
      (call: any[]) => call[0] === 'account-tools-library',
    ),
  ).toBe(false);
});
it('halts an uncertain send even with continue-on-failure selected and does not submit subsequent groups', async () => {
  const account = service();
  const queue = getBulkQueue({ services: { all: [account] } });
  ipcRenderer.invoke.mockImplementation(
    async (channel: string, _id: string, action: string) => {
      if (channel === 'account-tools-history') return [];
      if (channel === 'protocol-request' && action === 'send')
        throw Error('IPC timeout');
      return undefined;
    },
  );
  const id = await queue.submit(spec(account.id));
  const record = queue.records.find((value: any) => value.id === id);
  expect(record.status).toBe('待确认');
  expect(
    ipcRenderer.invoke.mock.calls.filter((call: any[]) => call[2] === 'send'),
  ).toHaveLength(1);
});
it('uses protocol group inventory without requiring a browser view or changing metadata fields', async () => {
  const account = service();
  const runtime = new GroupRuntime({ services: { all: [account] } });
  const target = {
    accountId: account.id,
    accountName: 'Account',
    ownerId: owner,
  };
  expect(await runtime.list(target)).toEqual([
    {
      ...target,
      target: '123456789012345@g.us',
      name: 'Group',
      admin: true,
      announce: false,
    },
  ]);
});
it.each(['isHibernating', 'isEnabled'])(
  'does not dispatch for an unavailable account (%s)',
  async flag => {
    const account = service();
    (account as any)[flag] = flag === 'isHibernating';
    const runtime = new GroupRuntime({ services: { all: [account] } });
    await expect(
      runtime.list({
        accountId: account.id,
        accountName: 'Account',
        ownerId: owner,
      }),
    ).rejects.toThrow('离线或休眠');
    expect(
      ipcRenderer.invoke.mock.calls.some(
        (call: any[]) => call[0] === 'protocol-request',
      ),
    ).toBe(false);
  },
);
it('rejects stale owner identity before calling the protocol backend', async () => {
  const account = service();
  const runtime = new GroupRuntime({ services: { all: [account] } });
  await expect(
    runtime.list({
      accountId: account.id,
      accountName: 'Account',
      ownerId: '5511777777777@c.us',
    }),
  ).rejects.toThrow('身份已变化');
  expect(
    ipcRenderer.invoke.mock.calls.some(
      (call: any[]) => call[0] === 'protocol-request',
    ),
  ).toBe(false);
});
it('persists opt-in per account while preserving all old sidebar preferences and the web default', () => {
  const original = normalizeAccountConfig({
    accounts: {
      one: { remark: 'original', zoom: 1.2, order: 4 },
      two: { manualSleep: true },
    },
  });
  const updated = updateAccount(original, 'one', {
    connectionMode: 'protocol',
  });
  const restored = JSON.parse(JSON.stringify(serializeAccountConfig(updated)));
  expect(restored.accounts.one).toMatchObject({
    connectionMode: 'protocol',
    remark: 'original',
    zoom: 1.2,
    order: 4,
  });
  expect(restored.accounts.two).toEqual({ manualSleep: true });
  expect(original.accounts.one.connectionMode).toBeUndefined();
});
