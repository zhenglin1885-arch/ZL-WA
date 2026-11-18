import { isIP } from 'node:net';

export type AccountNetworkTarget = 'whatsapp' | 'facebook';

// A public same-host resource avoids login redirects, which authenticated
// proxy transports intentionally reject. No Facebook login is required.
export const accountLatencyURL = (target: AccountNetworkTarget) =>
  target === 'facebook'
    ? 'https://business.facebook.com/robots.txt'
    : 'https://web.whatsapp.com/';

export interface AccountNetworkStatus {
  target: AccountNetworkTarget;
  ip: string;
  milliseconds?: number;
  ipError?: string;
  latencyError?: string;
  checkedAt: number;
}

// Both probes use the account transport supplied by the caller, never a global
// fetch that could bypass the account's proxy or credentials.
export async function probeAccountNetwork(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  target: AccountNetworkTarget = 'whatsapp',
): Promise<AccountNetworkStatus> {
  const [ip, latency] = await Promise.allSettled([
    (async () => {
      const response = await fetcher(
        'https://www.cloudflare.com/cdn-cgi/trace',
        {
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
        },
      );
      if (!response.ok) throw new Error(`IP 检测失败：HTTP ${response.status}`);
      const value = /^ip=(.+)$/m.exec(await response.text())?.[1]?.trim() || '';
      if (!isIP(value)) throw new Error('IP 检测返回无效地址');
      return value;
    })(),
    (async () => {
      const start = performance.now();
      const response = await fetcher(accountLatencyURL(target), {
        method: 'HEAD',
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(`延迟检测失败：HTTP ${response.status}`);
      return Math.max(1, Math.round(performance.now() - start));
    })(),
  ]);
  return {
    target,
    ip: ip.status === 'fulfilled' ? ip.value : '',
    milliseconds: latency.status === 'fulfilled' ? latency.value : undefined,
    ipError: ip.status === 'rejected' ? String(ip.reason) : undefined,
    latencyError:
      latency.status === 'rejected' ? String(latency.reason) : undefined,
    checkedAt: Date.now(),
  };
}
