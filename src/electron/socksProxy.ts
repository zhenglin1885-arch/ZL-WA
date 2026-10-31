/* eslint-disable no-use-before-define, @typescript-eslint/no-use-before-define -- Mutually dependent socket listeners share cleanup. */
/* eslint-disable no-void -- CONNECT tunnels run independently with handled rejections. */
// Chromium has no SOCKS username/password support. A per-account loopback
// CONNECT bridge performs RFC 1928/1929 authentication without exposing secrets.
import { createServer } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import type { ProxyConfig } from '../features/accountTools/config';

function read(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('readable', consume);
      socket.off('error', failed);
      socket.off('close', closed);
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const closed = () => failed(new Error('SOCKS5 连接已关闭'));
    const consume = () => {
      const bytes = socket.read(count) as Buffer | null;
      if (bytes) {
        cleanup();
        resolve(bytes);
      }
    };
    socket.on('readable', consume);
    socket.once('error', failed);
    socket.once('close', closed);
    consume();
  });
}
type Target = 'whatsapp-web' | 'whatsapp-resource' | 'other';
interface TunnelFailure {
  stage: string;
  code: string;
  at: number;
  target: Target;
}
export async function createSocksBridge(config: ProxyConfig, password: string) {
  const username = Buffer.from(config.username);
  const secret = Buffer.from(password);
  const authenticated = Boolean(username.length > 0 || secret.length > 0);
  if (
    username.length > 255 ||
    secret.length > 255 ||
    (authenticated && username.length === 0)
  )
    throw new Error('SOCKS5 用户名和密码最多为 255 字节，认证时用户名不能为空');
  let lastFailure: TunnelFailure | null = null;
  let lastWhatsAppFailure: TunnelFailure | null = null;
  const recentFailures: TunnelFailure[] = [];
  const established = { 'whatsapp-web': 0, 'whatsapp-resource': 0, other: 0 };
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {
      socket.destroy();
    });
  };
  const server = createServer((_request, response) => {
    response.writeHead(405);
    response.end();
  });
  server.on('connect', (request, stream, head) => {
    const client = stream as Socket;
    track(client);
    const upstream = connect({
      host: config.host.replaceAll(/^\[|]$/g, ''),
      port: Number(config.port),
    });
    track(upstream);
    const abort = () => {
      upstream.destroy();
      client.destroy();
    };
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    let stage = 'connect';
    let target: Target = 'other';
    let failedTunnel = false;
    const failure = (code: string) => {
      failedTunnel = true;
      lastFailure = { stage, code, at: Date.now(), target };
      if (target !== 'other') lastWhatsAppFailure = lastFailure;
      recentFailures.push(lastFailure);
      if (recentFailures.length > 12) recentFailures.shift();
    };
    upstream.once('error', (error: NodeJS.ErrnoException) => {
      failure(
        [
          'ECONNREFUSED',
          'ECONNRESET',
          'ETIMEDOUT',
          'ENOTFOUND',
          'EHOSTUNREACH',
          'ENETUNREACH',
        ].includes(error.code || '')
          ? error.code!
          : 'SOCKET_ERROR',
      );
    });
    const timeout = () => {
      failure('TIMEOUT');
      abort();
    };
    upstream.setTimeout(12_000, timeout);
    client.setTimeout(12_000, timeout);
    // All failures terminate this tunnel; there is no direct-network fallback.
    const tunnel = async () => {
      const destination = new URL(`https://${request.url}`);
      const host = destination.hostname.replaceAll(/^\[|]$/g, '').toLowerCase();
      target =
        host === 'web.whatsapp.com'
          ? 'whatsapp-web'
          : /(?:^|\.)whatsapp\.(?:com|net)$/.test(host)
            ? 'whatsapp-resource'
            : 'other';
      const port = Number(destination.port || 443);
      if (
        !host ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535 ||
        destination.username ||
        destination.password ||
        destination.pathname !== '/'
      )
        throw new Error('无效 CONNECT 地址');
      // Wait for TCP establishment so connect time and protocol failures remain distinct.
      await new Promise<void>((resolve, reject) => {
        const connected = () => {
          upstream.off('error', failed);
          upstream.off('close', closed);
          resolve();
        };
        const failed = (error: Error) => {
          upstream.off('connect', connected);
          upstream.off('close', closed);
          reject(error);
        };
        const closed = () => failed(new Error('SOCKS5 连接已关闭'));
        upstream.once('connect', connected);
        upstream.once('error', failed);
        upstream.once('close', closed);
      });
      stage = 'method';
      upstream.write(Buffer.from([5, 1, authenticated ? 2 : 0]));
      const method = await read(upstream, 2);
      if (method[0] !== 5 || method[1] !== (authenticated ? 2 : 0)) {
        failure('METHOD_REJECTED');
        throw new Error('SOCKS5 认证方式被拒绝');
      }
      if (authenticated) {
        stage = 'authentication';
        upstream.write(
          Buffer.concat([
            Buffer.from([1, username.length]),
            username,
            Buffer.from([secret.length]),
            secret,
          ]),
        );
        const auth = await read(upstream, 2);
        if (auth[0] !== 1 || auth[1] !== 0) {
          failure('AUTH_REJECTED');
          throw new Error('SOCKS5 用户名或密码错误');
        }
      }
      stage = 'destination';
      // Domain names are resolved by the upstream proxy, never by local DNS.
      let address: Buffer;
      if (isIP(host) === 4)
        address = Buffer.from([1, ...host.split('.').map(Number)]);
      else {
        const encoded = Buffer.from(host);
        if (encoded.length > 255) throw new Error('SOCKS5 地址过长');
        address = Buffer.concat([Buffer.from([3, encoded.length]), encoded]);
      }
      const end = Buffer.alloc(2);
      end.writeUInt16BE(port);
      upstream.write(Buffer.concat([Buffer.from([5, 1, 0]), address, end]));
      const reply = await read(upstream, 4);
      if (reply[0] !== 5 || reply[1] !== 0) {
        failure(
          reply[0] === 5 && reply[1] <= 8
            ? `REPLY_${reply[1]}`
            : 'INVALID_REPLY',
        );
        throw new Error('SOCKS5 无法连接目标地址');
      }
      switch (reply[3]) {
        case 1: {
          await read(upstream, 6);
          break;
        }
        case 4: {
          await read(upstream, 18);
          break;
        }
        case 3: {
          const size = await read(upstream, 1);
          await read(upstream, size[0] + 2);

          break;
        }
        default: {
          throw new Error('无效 SOCKS5 响应');
        }
      }
      established[target] += 1;
      stage = 'tunnel';
      upstream.setTimeout(0);
      client.setTimeout(0);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    };
    // No credential or provider error bodies are logged or returned to a webview.
    void tunnel().catch(() => {
      if (!failedTunnel) failure('CONNECTION_CLOSED');
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      upstream.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('无法启动 SOCKS5 桥接');
  return {
    port: address.port,
    diagnostics: () => ({
      lastFailure: lastFailure ? { ...lastFailure } : null,
      lastWhatsAppFailure: lastWhatsAppFailure
        ? { ...lastWhatsAppFailure }
        : null,
      recentFailures: recentFailures.map(failure => ({ ...failure })),
      established: { ...established },
    }),
    close: () => {
      server.close();
      for (const socket of sockets) socket.destroy();
      secret.fill(0);
    },
  };
}
