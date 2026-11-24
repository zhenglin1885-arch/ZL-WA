import vm from 'node:vm';
import { readOfficialFrameState } from '../src/features/accounts/sendDiagnostics';

it('reports a trusted loading frame and storage state without loading SDK modules or copying text and database names', async () => {
  const privateLoader = jest.fn(() => {
    throw Error('do not load native modules');
  });
  const context = {
    location: { hostname: 'web.whatsapp.com' },
    window: { require: privateLoader },
    document: {
      readyState: 'complete',
      body: { innerText: '正在加载你的对话 PRIVATE_CHAT' },
      querySelector: () => null,
    },
    navigator: { onLine: true, storage: { persisted: async () => true } },
    indexedDB: {
      databases: async () => [
        { name: 'model-storage' },
        { name: 'PRIVATE_NUMBER' },
      ],
    },
  };
  const value = await vm.runInNewContext(
    `(${readOfficialFrameState.toString()})()`,
    context,
  );
  expect(value).toMatchObject({
    loadingChats: true,
    storagePersisted: true,
    databaseCount: 2,
    modelStoragePresent: true,
  });
  expect(privateLoader).not.toHaveBeenCalled();
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE_CHAT|PRIVATE_NUMBER/);
});

it('reports opaque-frame storage restrictions without exposing raw errors', async () => {
  const error = Object.assign(Error('PRIVATE_AUTH'), { name: 'SecurityError' });
  const value = await vm.runInNewContext(
    `(${readOfficialFrameState.toString()})()`,
    {
      location: { hostname: 'web.whatsapp.com' },
      document: {
        readyState: 'complete',
        body: { innerText: '' },
        querySelector: () => null,
      },
      navigator: {
        onLine: true,
        storage: {
          persisted: async () => {
            throw error;
          },
        },
      },
      indexedDB: {
        databases: async () => {
          throw error;
        },
      },
    },
  );
  expect(value.storageError).toBe('SecurityError');
  expect(value.storagePersisted).toBeNull();
  expect(JSON.stringify(value)).not.toContain('PRIVATE_AUTH');
});

it('does not inspect a frame that navigated away from WhatsApp before execution', async () => {
  const value = await vm.runInNewContext(
    `(${readOfficialFrameState.toString()})()`,
    { location: { hostname: 'unrelated.invalid' } },
  );
  expect(value).toMatchObject({
    unavailable: true,
    reason: 'unexpected-origin',
  });
});

it('keeps persistence unknown when a page replaces the native API with an unexpected value', async () => {
  const value = await vm.runInNewContext(
    `(${readOfficialFrameState.toString()})()`,
    {
      location: { hostname: 'web.whatsapp.com' },
      document: {
        readyState: 'complete',
        body: { innerText: '' },
        querySelector: () => null,
      },
      navigator: {
        onLine: true,
        storage: { persisted: async () => 'PRIVATE_VALUE' },
      },
      indexedDB: { databases: async () => [] },
    },
  );
  expect(value.storagePersisted).toBeNull();
  expect(JSON.stringify(value)).not.toContain('PRIVATE_VALUE');
});
