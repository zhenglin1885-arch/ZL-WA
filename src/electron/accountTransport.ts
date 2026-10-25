// Session.fetch does not expose the proxy login event for main-process requests.
// net.request lets authenticated HTTP(S) proxies answer challenges per account.
import { net, type Session } from 'electron';
import type { ProxyConfig } from '../features/accountTools/config';

export function accountTransport(
  s: Session,
  proxy: ProxyConfig,
  password: () => string,
) {
  return (url: string, init: RequestInit): Promise<Response> => {
    if (
      !proxy.enabled ||
      proxy.mode !== 'manual' ||
      proxy.protocol === 'socks5' ||
      !proxy.username
    )
      return s.fetch(url, { ...init, bypassCustomProtocolHandlers: true });
    return new Promise((resolve, reject) => {
      const request = net.request({
        url,
        method: init.method || 'GET',
        session: s,
        redirect: 'error',
        bypassCustomProtocolHandlers: true,
      });
      const headers = new Headers(init.headers);
      headers.forEach((value, key) => request.setHeader(key, value));
      const abort = () => {
        request.abort();
        reject(new Error('账号网络请求已取消'));
      };
      init.signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => init.signal?.removeEventListener('abort', abort);
      let attempted = false;
      request.on('login', (auth, callback) => {
        if (
          attempted ||
          !auth.isProxy ||
          auth.host !== proxy.host.replaceAll(/^\[|]$/g, '') ||
          auth.port !== Number(proxy.port)
        ) {
          callback();
          return;
        }
        try {
          attempted = true;
          callback(proxy.username, password());
        } catch {
          callback();
        }
      });
      request.on('error', error => {
        cleanup();
        reject(error);
      });
      request.on('response', response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('error', error => {
          cleanup();
          reject(error);
        });
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 2_000_000) {
            abort();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          cleanup();
          const responseHeaders = new Headers();
          for (const [name, values] of Object.entries(response.headers || {}))
            for (const value of Array.isArray(values) ? values : [values])
              if (value !== undefined) responseHeaders.append(name, value);
          resolve(
            new Response(
              response.statusCode === 204 || init.method === 'HEAD'
                ? null
                : Buffer.concat(chunks),
              { status: response.statusCode, headers: responseHeaders },
            ),
          );
        });
      });
      if (init.signal?.aborted) {
        abort();
        return;
      }
      if (typeof init.body === 'string') request.write(init.body);
      request.end();
    });
  };
}
