/* eslint-disable no-await-in-loop, no-continue -- Recovery stays in a cancellable native dialog loop, before accounts start. */
import { dirname } from 'node:path';
import type { Dialog } from 'electron';
import type CacheLocation from './CacheLocation';

export async function recoverCacheLocation(
  location: CacheLocation,
  dialog: Pick<Dialog, 'showMessageBox' | 'showOpenDialog'>,
  initialError: unknown,
): Promise<boolean> {
  let error = String(initialError);
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: '恢复缓存与账号数据',
      message: '原缓存目录无法使用，账号尚未启动',
      detail: `${error}\n\n原目录：${location.state().current}\n\n如果目录被移动或有完整备份，请选择原缓存文件夹。若文件夹已被删除且没有备份，需要选择新目录并重新登录。不会自动创建空目录冒充原账号数据，也不会删除旧配置或旧目录。`,
      buttons: [
        '重新检查原目录',
        '选择已有数据目录',
        '使用新目录并重新登录',
        '退出软件',
      ],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    });
    if (response === 3) return false;
    try {
      if (response === 0) {
        location.initialize();
        return true;
      }
      if (response === 1) {
        const picked = await dialog.showOpenDialog({
          title: '选择完整的原缓存文件夹（包含 Partitions 和缓存标记文件）',
          defaultPath: dirname(location.profile),
          properties: ['openDirectory'],
        });
        if (!picked.canceled && picked.filePaths[0]) {
          location.recoverExisting(picked.filePaths[0]);
          return true;
        }
      } else if (response === 2) {
        const confirm = await dialog.showMessageBox({
          type: 'warning',
          title: '确认重新登录',
          message: '将在新目录重新建立网页数据，需要重新登录 WhatsApp 账号',
          detail:
            '这不会恢复已经删除的登录状态或网页数据。旧路径配置会另存保留，已有账号卡片、群发记录和本机聊天备份不会被清除。',
          buttons: ['取消', '确认并选择新目录'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirm.response !== 1) continue;
        const picked = await dialog.showOpenDialog({
          title: '选择安装目录以外的缓存保存位置',
          defaultPath: dirname(location.profile),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (!picked.canceled && picked.filePaths[0]) {
          location.createFresh(picked.filePaths[0]);
          return true;
        }
      }
    } catch (error_) {
      error = String(error_);
    }
  }
}
