import { dialog, type BrowserWindow } from 'electron';
import type { WindowHealthEvent } from './windowHealth';

// Do not continue into a partially initialized app: proxy/authentication IPC
// may not have been installed. Keep original files and offer native diagnostics.
export async function showMainStartupFailure(
  window: BrowserWindow,
  error: unknown,
  hooks: {
    record: (event: WindowHealthEvent) => void;
    exportDiagnostics: () => unknown;
    quit: () => void;
  },
) {
  const reason =
    error instanceof Error &&
    error.message === '账号工具配置损坏，请备份并检查 account-tools.json'
      ? 'ACCOUNT_TOOLS_CONFIG_INVALID'
      : 'MAIN_INITIALIZATION_FAILED';
  hooks.record({ event: 'main-initialization-failed', reason });
  try {
    window.show();
    const { response } = await dialog.showMessageBox(window, {
      type: 'error',
      title: 'ZL-WA 启动未完成',
      message: '本地功能初始化失败，账号尚未打开',
      detail: `${
        reason === 'ACCOUNT_TOOLS_CONFIG_INVALID'
          ? '账号工具配置 account-tools.json 无法读取。'
          : '软件在初始化本地功能时遇到错误。'
      }\n请导出诊断以便定位原因。原配置与账号数据均保留，重新载入界面不能修复此类初始化错误。`,
      buttons: ['Export Diagnostics', 'Quit ZL-WA'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) await hooks.exportDiagnostics();
  } finally {
    hooks.quit();
  }
}
