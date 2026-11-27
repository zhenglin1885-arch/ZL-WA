import { ipcRenderer } from 'electron';
import { observer } from 'mobx-react';
import { useEffect, useState } from 'react';
import type { RealStores } from '../../stores';
import { isFacebookBusiness } from '../accounts/facebook';
import type { AccountNetworkStatus as NetworkStatus } from '../../electron/AccountNetwork';

export default observer(function AccountNetworkStatus({
  stores,
}: {
  stores: RealStores;
}) {
  const service = stores.services.active;
  const facebook = Boolean(service && isFacebookBusiness(service));
  const target = facebook ? 'facebook' : 'whatsapp';
  const id =
    (service?.recipe.id === 'whatsapp' || facebook) &&
    service &&
    service.isEnabled &&
    !service.isHibernating
      ? service.id
      : '';
  const [state, setState] = useState<{
    id: string;
    result?: NetworkStatus;
    error?: string;
    busy: boolean;
  }>({ id: '', busy: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    const refresh = async (force = false) => {
      if (!id || pending || stopped) return;
      pending = true;
      setState({ id, busy: true });
      try {
        const result = await ipcRenderer.invoke(
          'account-tools-network-status',
          id,
          force,
          target,
        );
        if (!stopped) setState({ id, result, busy: false });
      } catch (error) {
        if (!stopped) setState({ id, error: String(error), busy: false });
      } finally {
        pending = false;
      }
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id)
        setRevision(value => value + 1);
    };
    void refresh(revision > 0);
    const timer = setInterval(() => {
      void refresh(true);
    }, 60_000);
    window.addEventListener('zl-account-network-changed', changed);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('zl-account-network-changed', changed);
    };
  }, [id, revision, target]);
  const current = state.id === id ? state : undefined;
  const result = current?.result;
  const ms = result?.milliseconds;
  const color =
    ms === undefined
      ? 'unknown'
      : ms < 300
        ? 'good'
        : ms < 1000
          ? 'slow'
          : 'poor';
  const title = id
    ? [
        `当前账号：${service?.accountSnapshot.nickname || service?.name}`,
        `IP 为该账号实际网络出口；延迟为到 ${facebook ? 'Meta Business Suite' : 'WhatsApp'} 的 HTTPS 请求耗时。`,
        result?.ip ? `出口 IP：${result.ip}` : '',
        current?.error,
        result?.ipError,
        result?.latencyError,
        result
          ? `检测时间：${new Date(result.checkedAt).toLocaleTimeString()}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '请选择已启用且未休眠的 WhatsApp 或 Facebook Business 账号';
  return (
    <div
      className="account-network-status"
      title={title}
      aria-label="当前账号网络状态"
    >
      <span className="account-network-status__ip">
        IP: {result?.ip || '—'}
      </span>
      <span
        className={`account-network-status__latency account-network-status__latency--${color}`}
      >
        <span className="account-network-status__dot" aria-hidden="true" />
        {current?.busy ? '检测中…' : ms === undefined ? '— ms' : `${ms} ms`}
      </span>
      <button
        type="button"
        aria-label="刷新 IP 和延迟"
        title="刷新 IP 和延迟"
        disabled={!id || current?.busy}
        onClick={() => setRevision(value => value + 1)}
      >
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
        </svg>
      </button>
    </div>
  );
});
