import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';
import { ferdiumVersion } from '../../environment-remote';
import { RELEASES_URL, type UpdateState } from './config';

export default function GitHubUpdatesPanel() {
  const [state, setState] = useState<UpdateState>({});
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let mounted = true;
    const listener = (_: unknown, value: UpdateState) => {
      if (mounted) setState(value);
    };
    ipcRenderer.on('autoUpdate', listener);
    void ipcRenderer
      .invoke('zl-updates-state')
      .then(value => {
        if (mounted) setState(value);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      ipcRenderer.removeListener('autoUpdate', listener);
    };
  }, []);
  return (
    <section className="zl-updates" aria-label="ZL-WA 在线更新">
      <p>
        当前版本：<strong>{ferdiumVersion}</strong>
      </p>
      <p>在线检测 ZL-WA 更新包，下载安装后升级。</p>
      <div className="zl-updates-buttons">
        <button
          type="button"
          disabled={state.checking || state.downloading}
          onClick={async () => {
            setNotice('');
            setState({ checking: true });
            try {
              setState(await ipcRenderer.invoke('zl-updates-check'));
            } catch {
              setState({ error: { message: '无法检查更新，请稍后重试' } });
            }
          }}
        >
          {state.checking ? '正在检查…' : '检查在线更新'}
        </button>
        <a href={RELEASES_URL} target="_blank" rel="noreferrer">
          查看更新说明
        </a>
      </div>
      <div role="status" aria-live="polite">
        {state.checking
          ? '正在检测在线更新包…'
          : state.downloading
            ? `正在下载更新包：${state.progress || 0}%`
            : state.error
              ? state.error.message
              : state.downloaded
                ? '更新包下载并校验完成，可退出软件并安装。'
                : state.available
                  ? `发现新版本 ${state.version}`
                  : state.available === false
                    ? '你使用的 ZL-WA 已是当前更新通道的最新版本。'
                    : '点击检查在线更新，获取可用的安装包。'}
      </div>
      {state.available && !state.downloaded && (
        <button
          type="button"
          disabled={state.downloading}
          onClick={async () => {
            setNotice('');
            try {
              setState(await ipcRenderer.invoke('zl-updates-download'));
            } catch {
              setNotice('无法下载更新包，请稍后重试');
            }
          }}
        >
          {state.downloading ? '下载中…' : `下载安装更新 ${state.version}`}
        </button>
      )}
      {state.downloaded && (
        <button
          type="button"
          onClick={async () => {
            setNotice('');
            try {
              await ipcRenderer.invoke('zl-updates-install');
            } catch {
              setNotice('无法启动安装，请重新下载更新包后重试');
            }
          }}
        >
          退出并安装
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="zl-updates-help">
        开启自动更新后，启动约 30 秒及之后每 4 小时检查一次。
        发现新版会提示，由你选择下载及安装。关闭自动更新后仍可手动检查。 Windows
        便携版也可下载并启动安装版升级。
      </p>
    </section>
  );
}
