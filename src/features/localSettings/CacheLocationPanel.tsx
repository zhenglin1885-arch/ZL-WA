/* eslint-disable no-void -- UI promises handle and display their own errors. */
import { useEffect, useState } from 'react';
import { ipcRenderer } from 'electron';
import type { CacheLocationState } from '../../electron/CacheLocation';

export default function CacheLocationPanel() {
  const [state, setState] = useState<CacheLocationState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    ipcRenderer
      .invoke('zl-cache-location-state')
      .then(setState)
      .catch(error_ => setError(String(error_)));
  }, []);
  const action = async (channel: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await ipcRenderer.invoke(channel);
      if (channel.endsWith('-open')) {
        if (result) throw new Error(result);
      } else setState(result);
    } catch (error_) {
      setError(String(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="local-cache-settings" aria-label="本机缓存与网页数据">
      <h3>本机缓存与网页数据</h3>
      {state ? (
        <>
          <p>
            当前目录：
            <span className="local-cache-settings__path">{state.current}</span>
          </p>
          {state.pending && (
            <p role="status">
              重启后迁移到：
              <span className="local-cache-settings__path">{state.next}</span>
            </p>
          )}
          <div className="local-cache-settings__actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void action('zl-cache-location-select')}
            >
              选择文件夹…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action('zl-cache-location-open')}
            >
              打开当前目录
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action('zl-cache-location-reset')}
            >
              恢复默认目录
            </button>
            {state.pending && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action('zl-cache-location-cancel')}
              >
                取消变更
              </button>
            )}
          </div>
          <p className="settings__help">
            将在所选文件夹中创建“ZL-WA缓存”子目录。完全退出并重新启动后生效；届时先迁移并检查现有账号的网页数据，再启用新目录。首次迁移可能需要几分钟。迁移失败会保留原数据并继续使用原目录。
          </p>
          <p className="settings__help">
            账号配置、群发记录和聊天备份保留在原位置。便携版默认已在软件所在目录保存数据。
          </p>
          {state.error && <p role="alert">{state.error}</p>}
        </>
      ) : (
        <p>正在读取本机配置…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
