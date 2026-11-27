import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('privileged local bulk attachments', () => {
  let root: string;
  let handlers: Record<string, any>;
  let event: any;
  let open: jest.Mock;
  beforeEach(() => {
    jest.resetModules();
    root = mkdtempSync(join(tmpdir(), 'zl-bulk-'));
    handlers = {};
    const mainWindow = { webContents: { mainFrame: {} } };
    event = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    };
    open = jest.fn().mockResolvedValue({ canceled: true, filePaths: [] });
    jest.doMock('electron', () => ({
      app: { getPath: () => root },
      dialog: { showOpenDialog: open },
      ipcMain: {
        handle: (name: string, fn: any) => {
          handlers[name] = fn;
        },
      },
    }));
    require('../src/electron/ipc-api/bulkMedia').default(mainWindow);
  });
  afterEach(() => {
    jest.dontMock('electron');
    rmSync(root, { recursive: true, force: true });
  });
  it('copies only a file explicitly chosen through the native file picker and reads by opaque ID', async () => {
    const source = join(root, 'picked.png');
    writeFileSync(source, Buffer.from([1, 2, 3]));
    open.mockResolvedValue({ canceled: false, filePaths: [source] });
    const media = await handlers['account-tools-media-pick'](event, 'image');
    expect(media).toMatchObject({
      name: 'picked.png',
      mime: 'image/png',
      size: 3,
    });
    expect(handlers['account-tools-media-read'](event, media.id)).toBe(
      'data:image/png;base64,AQID',
    );
    expect(readFileSync(join(root, 'bulk-media', media.id))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(() =>
      handlers['account-tools-media-read'](event, '../../secret'),
    ).toThrow('无效');
  });
  it('rejects wrong media types and denies guest/subframe access to file and library handlers', async () => {
    const source = join(root, 'script.exe');
    writeFileSync(source, 'binary');
    open.mockResolvedValue({ canceled: false, filePaths: [source] });
    await expect(
      handlers['account-tools-media-pick'](event, 'image'),
    ).rejects.toThrow('类型');
    event.senderFrame = {};
    await expect(
      handlers['account-tools-media-pick'](event, 'document'),
    ).rejects.toThrow('禁止');
    expect(() => handlers['account-tools-media-read'](event, 'bad')).toThrow(
      '禁止',
    );
    expect(() => handlers['account-tools-library'](event)).toThrow('禁止');
  });
});
