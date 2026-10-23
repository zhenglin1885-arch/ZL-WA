import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';

export default function localDiagnostics(mainWindow: BrowserWindow) {
  ipcMain.handle('zl-export-diagnostics', async (event, content: unknown) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('禁止访问诊断信息');
    if (typeof content !== 'string' || Buffer.byteLength(content) > 2_000_000)
      throw new Error('诊断信息无效');
    JSON.parse(content);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存本地诊断信息',
      defaultPath: 'ZL-WA-diagnostics.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, content, 'utf8');
    return true;
  });
}
