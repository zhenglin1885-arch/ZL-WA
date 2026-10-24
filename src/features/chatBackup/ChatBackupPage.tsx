/* eslint-disable no-void -- UI handlers start promises with their own error handling. */
import { useEffect, useState } from 'react';
import { inject, observer } from 'mobx-react';
import { ipcRenderer } from 'electron';
import type { StoresProps } from '../../@types/ferdium-components.types';
import type { BackupConfig, BackupState } from './types';
import { backupRuntime } from './runtime';

export default inject('stores')(
  observer(function ChatBackupPage({ stores }: Partial<StoresProps>) {
    const [state, setState] = useState<BackupState>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [selection, setSelection] = useState('all');
    const [account, setAccount] = useState('');
    const [notice, setNotice] = useState('');
    const [, render] = useState(0);
    const runtime = backupRuntime(stores!);
    const refresh = () =>
      ipcRenderer
        .invoke('chat-backup-state')
        .then(setState)
        .catch(error_ => setError(String(error_)));
    useEffect(() => {
      void refresh();
      const listener = () => {
        render(v => v + 1);
      };
      runtime.listeners.add(listener);
      const timer = setInterval(() => {
        void refresh();
      }, 3000);
      return () => {
        runtime.listeners.delete(listener);
        clearInterval(timer);
      };
    }, [runtime]);
    const update = async (change: Partial<BackupConfig>) => {
      if (!state) return;
      try {
        setState(await ipcRenderer.invoke('chat-backup-config', change));
        setError('');
      } catch (error_) {
        setError(String(error_));
      }
    };
    const accounts = stores!.services.all.filter(
      s =>
        s.recipe.id === 'whatsapp' &&
        s.isEnabled &&
        !s.isHibernating &&
        s.accountSnapshot.status === 'online',
    );
    const chosen =
      account || accounts.find(s => s.isActive)?.id || accounts[0]?.id || '';
    const action = async (fn: () => Promise<any>) => {
      setBusy(true);
      setError('');
      try {
        await fn();
        await refresh();
      } catch (error_) {
        setError(String(error_));
      } finally {
        setBusy(false);
      }
    };
    if (!state)
      return (
        <div className="settings__main">
          <div className="settings__header">
            <span className="settings__header-item">聊天备份</span>
          </div>
          <div className="settings__body" role="status">
            {error || '正在读取本地聊天备份…'}
          </div>
        </div>
      );
    const { config, stats } = state;
    const row: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: '120px minmax(0,1fr)',
      gap: 16,
      alignItems: 'start',
      margin: '20px 0',
    };
    const input: React.CSSProperties = {
      padding: '8px 12px',
      background: 'transparent',
      color: 'inherit',
      border: '1px solid #566069',
      borderRadius: 7,
      maxWidth: '100%',
    };
    return (
      <div className="settings__main">
        <div className="settings__header">
          <span className="settings__header-item">聊天备份</span>
        </div>
        <section className="settings__body chat-backup-settings">
          <div style={row}>
            <span>保存聊天记录</span>
            <div>
              <label htmlFor="chat-backup-enabled">
                <input
                  id="chat-backup-enabled"
                  aria-label="保存聊天记录"
                  type="checkbox"
                  checked={config.enabled}
                  onChange={e => {
                    void update({ enabled: e.target.checked });
                  }}
                />{' '}
                保存（只存在本机，不上传）
              </label>
              <p>
                保存打开过的 WhatsApp
                对话中的文字、译文和可获取的照片，本机记录加密保存。账号退出或封号不会删除已有备份。Facebook
                暂不支持。
              </p>
            </div>
          </div>
          <div style={row}>
            <span>每天自动导出</span>
            <div>
              <label htmlFor="chat-backup-automatic">
                <input
                  id="chat-backup-automatic"
                  type="checkbox"
                  checked={config.automatic}
                  onChange={e => {
                    void update({ automatic: e.target.checked });
                  }}
                />{' '}
                每天{' '}
              </label>
              <input
                aria-label="自动导出时间"
                style={input}
                type="time"
                value={config.time}
                onChange={e => {
                  if (e.target.value) void update({ time: e.target.value });
                }}
              />
              <p>
                到时间自动导出当天记录；软件未运行时，下次启动后补导出。HTML
                和已导出的图片可离线查看，导出文件为未加密文件。
              </p>
            </div>
          </div>
          <div style={row}>
            <span>导出到</span>
            <div style={{ overflowWrap: 'anywhere' }}>
              {config.directory}{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void action(async () =>
                    setState(await ipcRenderer.invoke('chat-backup-directory')),
                  );
                }}
              >
                更换…
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  void action(async () => {
                    const reason = await ipcRenderer.invoke('chat-backup-open');
                    if (reason) throw new Error(reason);
                  });
                }}
              >
                打开文件夹
              </button>
            </div>
          </div>
          <div style={row}>
            <span>本机保存</span>
            <div>
              <select
                aria-label="备份保留期限"
                style={input}
                value={config.retentionDays}
                onChange={e => {
                  void update({ retentionDays: Number(e.target.value) });
                }}
              >
                {[
                  [7, '7 天'],
                  [30, '30 天'],
                  [90, '90 天'],
                  [180, '半年'],
                  [365, '1 年'],
                  [730, '2 年'],
                  [0, '永久'],
                ].map(([days, label]) => (
                  <option key={days} value={days}>
                    {label}
                  </option>
                ))}
              </select>
              <p>到期记录从本机加密存储删除，已经导出的文件不受影响。</p>
            </div>
          </div>
          <div style={row}>
            <span>已保存</span>
            <span>
              {stats.messages} 条消息、{stats.images} 张图片（
              {(stats.bytes / 1024 / 1024).toFixed(1)} MB，{stats.days.length}{' '}
              天）
            </span>
          </div>
          <div style={row}>
            <span>同步历史聊天记录</span>
            <div>
              <select
                aria-label="备份同步账号"
                style={input}
                value={chosen}
                disabled={!!runtime.active}
                onChange={e => setAccount(e.target.value)}
              >
                <option value="">请选择在线 WhatsApp 账号</option>
                <option value="all" disabled={accounts.length === 0}>
                  全部在线 WhatsApp 账号
                </option>
                {accounts.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.accountSnapshot.nickname || s.name}{' '}
                    {s.accountSnapshot.phone || ''}
                  </option>
                ))}
              </select>{' '}
              <button
                type="button"
                disabled={!chosen || !config.enabled || !!runtime.active}
                onClick={() => {
                  void action(() => runtime.synchronize(stores!, chosen));
                }}
              >
                开始同步
              </button>{' '}
              <button
                type="button"
                disabled={!runtime.active}
                onClick={() => runtime.stop()}
              >
                停止同步
              </button>
              <p>
                只读取 WhatsApp
                网页可获取的历史，不发送消息。先登录需要同步的账号；可随时停止，已保存内容不会丢失。
              </p>
              <p role="status">{runtime.progress}</p>
              {runtime.error && <p role="alert">{runtime.error}</p>}
            </div>
          </div>
          <div style={row}>
            <span>手动导出</span>
            <div>
              <select
                aria-label="备份导出范围"
                style={input}
                value={selection}
                onChange={e => setSelection(e.target.value)}
              >
                <option value="all">
                  全部（每个对话一个文件，共 {stats.days.length} 天）
                </option>
                {stats.days.map(day => (
                  <option key={day}>{day}</option>
                ))}
              </select>{' '}
              <button
                type="button"
                disabled={busy || stats.messages === 0}
                onClick={() => {
                  void action(async () => {
                    const path = await ipcRenderer.invoke(
                      'chat-backup-export',
                      selection,
                    );
                    setNotice(`已导出：${path}`);
                  });
                }}
              >
                导出
              </button>
              <p>
                先按账号分文件夹，再按全部记录或日期分类。图片嵌入对话
                HTML，复制 HTML
                即可离线查看。“全部”每次更新为当前已保存的完整记录。
              </p>
              {stats.lastExport && (
                <p>上次导出：{new Date(stats.lastExport).toLocaleString()}</p>
              )}
              <p role="status">{notice}</p>
            </div>
          </div>
          {(error || stats.error) && (
            <p role="alert" style={{ color: '#f56b6b' }}>
              {error || stats.error}
            </p>
          )}
        </section>
      </div>
    );
  }),
);
