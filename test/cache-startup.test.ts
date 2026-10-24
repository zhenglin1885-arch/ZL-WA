import { recoverCacheLocation } from '../src/electron/cacheStartup';

const setup = () => {
  const location: any = {
    profile: '/profile',
    state: () => ({ current: '/missing' }),
    initialize: jest.fn(),
    recoverExisting: jest.fn(),
    createFresh: jest.fn(),
  };
  const dialog: any = { showMessageBox: jest.fn(), showOpenDialog: jest.fn() };
  return { location, dialog };
};
test('exit never creates a fresh session or changes any data', async () => {
  const { location, dialog } = setup();
  dialog.showMessageBox.mockResolvedValue({ response: 3 });
  expect(
    await recoverCacheLocation(location, dialog, new Error('missing')),
  ).toBe(false);
  expect(location.initialize).not.toHaveBeenCalled();
  expect(location.createFresh).not.toHaveBeenCalled();
  expect(location.recoverExisting).not.toHaveBeenCalled();
});
test('restoring a disk retries the original path and requests a clean restart', async () => {
  const { location, dialog } = setup();
  dialog.showMessageBox.mockResolvedValue({ response: 0 });
  expect(await recoverCacheLocation(location, dialog, 'missing')).toBe(true);
  expect(location.initialize).toHaveBeenCalledTimes(1);
  expect(location.createFresh).not.toHaveBeenCalled();
});
test('selecting an intact original folder adopts it without fresh-login initialization', async () => {
  const { location, dialog } = setup();
  dialog.showMessageBox.mockResolvedValue({ response: 1 });
  dialog.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ['/restored'],
  });
  expect(await recoverCacheLocation(location, dialog, 'missing')).toBe(true);
  expect(location.recoverExisting).toHaveBeenCalledWith('/restored');
  expect(location.createFresh).not.toHaveBeenCalled();
});
test('fresh login requires an explicit confirmation and a folder choice', async () => {
  const { location, dialog } = setup();
  dialog.showMessageBox
    .mockResolvedValueOnce({ response: 2 })
    .mockResolvedValueOnce({ response: 1 });
  dialog.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ['/safe'],
  });
  expect(await recoverCacheLocation(location, dialog, 'missing')).toBe(true);
  expect(location.createFresh).toHaveBeenCalledWith('/safe');
  expect(location.initialize).not.toHaveBeenCalled();
});
test('cancelling fresh login leaves all existing settings untouched', async () => {
  const { location, dialog } = setup();
  dialog.showMessageBox
    .mockResolvedValueOnce({ response: 2 })
    .mockResolvedValueOnce({ response: 0 })
    .mockResolvedValueOnce({ response: 3 });
  expect(await recoverCacheLocation(location, dialog, 'missing')).toBe(false);
  expect(location.createFresh).not.toHaveBeenCalled();
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});
test('invalid or unsafe recovered folders return to the recovery UI with the specific error', async () => {
  const { location, dialog } = setup();
  dialog.showMessageBox
    .mockResolvedValueOnce({ response: 1 })
    .mockResolvedValueOnce({ response: 3 });
  dialog.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ['/foreign'],
  });
  location.recoverExisting.mockImplementation(() => {
    throw new Error('foreign folder');
  });
  expect(await recoverCacheLocation(location, dialog, 'missing')).toBe(false);
  expect(dialog.showMessageBox.mock.calls[1][0].detail).toContain(
    'foreign folder',
  );
  expect(location.createFresh).not.toHaveBeenCalled();
});
