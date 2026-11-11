/* eslint-disable no-await-in-loop, no-continue -- Native configuration recovery remains in a user-controlled dialog loop. */
import { dialog, type BrowserWindow } from 'electron';
import { dirname } from 'node:path';
import type { WindowHealthEvent } from './windowHealth';
import { AccountToolsFileError } from './AccountToolsFile';

// Do not continue into a partially initialized app: proxy/authentication IPC
// may not have been installed. Keep original files and offer native diagnostics.
export async function showMainStartupFailure(
  window: BrowserWindow,
  error: unknown,
  hooks: {
    record: (event: WindowHealthEvent) => void;
    exportDiagnostics: () => unknown;
    quit: () => void;
    restart?: () => void;
  },
) {
  const configuration = error instanceof AccountToolsFileError ? error : null;
  const reason =
    configuration ||
    (error instanceof Error &&
      error.message === '账号工具配置损坏，请备份并检查 account-tools.json')
      ? 'ACCOUNT_TOOLS_CONFIG_INVALID'
      : 'MAIN_INITIALIZATION_FAILED';
  hooks.record({
    event: 'main-initialization-failed',
    reason,
    ...(configuration ? { configuration: configuration.diagnostic } : {}),
  });
  let recovered = false;
  try {
    window.show();
    for (;;) {
      const detail = configuration
        ? {
            EMPTY: '配置文件为空。',
            ZERO_FILLED:
              '配置文件全部为零字节，已没有可解析的配置内容。需要完整备份才能恢复原设置。',
            ENCODING: '配置文件的字符编码无效。',
            JSON: '配置文件的 JSON 格式不完整或无效。',
            STRUCTURE: '配置文件的内容结构无效。',
            READ: '无法读取配置文件，请检查文件权限和磁盘状态。',
          }[configuration.diagnostic.code]
        : '';
      const canRestore = Boolean(configuration && hooks.restart);
      const { response } = await dialog.showMessageBox(window, {
        type: 'error',
        title: 'ZL-WA 启动未完成',
        message: '本地功能初始化失败，账号尚未打开',
        detail: `${
          reason === 'ACCOUNT_TOOLS_CONFIG_INVALID'
            ? '账号工具配置 account-tools.json 无法读取。'
            : '软件在初始化本地功能时遇到错误。'
        }${detail}\n请导出诊断以便定位原因。原配置与账号数据均保留，重新载入界面不能修复此类初始化错误。${canRestore ? '\n恢复备份会恢复其中的代理、翻译设置和记录，重启前会另存当前文件。' : ''}`,
        buttons: canRestore
          ? ['Export Diagnostics', '恢复配置备份…', 'Quit ZL-WA']
          : ['Export Diagnostics', 'Quit ZL-WA'],
        defaultId: 0,
        cancelId: canRestore ? 2 : 1,
        noLink: true,
      });
      if (response === 0) {
        await hooks.exportDiagnostics();
        return;
      }
      if (!configuration || !canRestore || response !== 1) return;
      const candidates = configuration.file.backups();
      const picked = await dialog.showOpenDialog(window, {
        title: '选择此软件的完整账号工具配置备份',
        defaultPath: candidates[0]?.path || dirname(configuration.file.path),
        properties: ['openFile'],
        filters: [
          { name: '配置或备份', extensions: ['json', 'bak', 'tmp'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (picked.canceled || !picked.filePaths[0]) continue;
      try {
        configuration.file.restoreFrom(picked.filePaths[0]);
      } catch {
        await dialog.showMessageBox(window, {
          type: 'error',
          message: '配置备份未能恢复',
          detail:
            '原配置仍保留。请检查所选备份是否完整，以及配置目录是否允许读写。',
          buttons: ['确定'],
        });
        continue;
      }
      hooks.record({ event: 'account-tools-config-restored' });
      recovered = true;
      hooks.restart!();
      return;
    }
  } finally {
    if (!recovered) hooks.quit();
  }
}
