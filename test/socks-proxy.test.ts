/* eslint-disable jest/no-conditional-expect -- Each protocol/provider branch checks its distinct wire format. */
import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { createSocksBridge } from '../src/electron/socksProxy';
import { defaultTools } from '../src/features/accountTools/config';

it('authenticates SOCKS5, sends remote DNS names, preserves tunneled bytes, and closes account sockets', async () => {
  const connections = new Set<Socket>();
  const received: Buffer[] = [];
  const upstream = createServer(socket => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    let phase = 0;
    socket.on('data', data => {
      received.push(data);
      switch (phase) {
        case 0: {
          expect([...data]).toEqual([5, 1, 2]);
          socket.write(Buffer.from([5]));
          setImmediate(() => socket.write(Buffer.from([2])));

          break;
        }
        case 1: {
          expect(data).toEqual(
            Buffer.from([
              1,
              4,
              ...Buffer.from('user'),
              4,
              ...Buffer.from('pass'),
            ]),
          );
          socket.write(Buffer.from([1, 0]));

          break;
        }
        case 2: {
          expect(data.subarray(0, 5)).toEqual(Buffer.from([5, 1, 0, 3, 16]));
          expect(data.subarray(5, -2).toString()).toBe('web.whatsapp.com');
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));

          break;
        }
        default: {
          socket.write(data);
        }
      }
      phase += 1;
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const bridge = await createSocksBridge(
    {
      ...defaultTools().proxy,
      host: '127.0.0.1',
      port: String(address.port),
      username: 'user',
    },
    'pass',
  );
  const client = connect(bridge.port, '127.0.0.1');
  try {
    await once(client, 'connect');
    client.write(
      'CONNECT web.whatsapp.com:443 HTTP/1.1\r\nHost: web.whatsapp.com:443\r\n\r\n',
    );
    const [reply] = await once(client, 'data');
    expect(reply.toString()).toContain('200 Connection Established');
    client.write('synthetic-encrypted-traffic');
    const [echo] = await once(client, 'data');
    expect(echo.toString()).toBe('synthetic-encrypted-traffic');
    expect(received).toHaveLength(4);
    const closed = once(client, 'close');
    bridge.close();
    await closed;
  } finally {
    client.destroy();
    bridge.close();
    for (const socket of connections) socket.destroy();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
    });
  }
});

it('rejects unusable SOCKS credentials before starting a listener', async () => {
  await expect(
    createSocksBridge(
      { ...defaultTools().proxy, username: 'x'.repeat(256) },
      'secret',
    ),
  ).rejects.toThrow('255');
});

it.each([0, 2, 4, 5])(
  'handles unauthenticated SOCKS reply %i without using direct networking',
  async code => {
    const sockets = new Set<Socket>();
    const packets: Buffer[] = [];
    const upstream = createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let phase = 0;
      socket.on('data', data => {
        packets.push(data);
        const current = phase;
        phase += 1;
        if (current === 0) socket.write(Buffer.from([5, 0]));
        else socket.write(Buffer.from([5, code, 0, 1, 127, 0, 0, 1, 0, 80]));
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const bridge = await createSocksBridge(
      {
        ...defaultTools().proxy,
        host: '127.0.0.1',
        port: String(address.port),
      },
      '',
    );
    const client = connect(bridge.port, '127.0.0.1');
    try {
      await once(client, 'connect');
      client.write(
        'CONNECT web.whatsapp.com:443 HTTP/1.1\r\nHost: web.whatsapp.com:443\r\n\r\n',
      );
      const [reply] = await once(client, 'data');
      expect(packets[0]).toEqual(Buffer.from([5, 1, 0]));
      expect(packets[1].subarray(5, -2).toString()).toBe('web.whatsapp.com');
      expect(reply.toString()).toContain(
        code === 0 ? '200 Connection Established' : '502 Bad Gateway',
      );
      expect(bridge.diagnostics()).toMatchObject({
        lastFailure:
          code === 0
            ? null
            : {
                target: 'whatsapp-web',
                stage: 'destination',
                code: `REPLY_${code}`,
                at: expect.any(Number),
              },
      });
    } finally {
      client.destroy();
      bridge.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => {
        upstream.close(() => resolve());
      });
    }
  },
);

it('drains a complete upstream response before closing a backpressured browser tunnel', async () => {
  const sockets = new Set<Socket>();
  const payload = Buffer.alloc(8_000_013, 97);
  const upstream = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let phase = 0;
    socket.on('data', () => {
      const current = phase;
      phase += 1;
      if (current === 0) socket.write(Buffer.from([5, 0]));
      else if (current === 1)
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
      else socket.end(payload);
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const bridge = await createSocksBridge(
    { ...defaultTools().proxy, host: '127.0.0.1', port: String(address.port) },
    '',
  );
  const client = connect(bridge.port, '127.0.0.1');
  try {
    await once(client, 'connect');
    client.write(
      'CONNECT web.whatsapp.com:443 HTTP/1.1\r\nHost: web.whatsapp.com:443\r\n\r\n',
    );
    await once(client, 'data');
    client.pause();
    const chunks: Buffer[] = [];
    client.on('data', data => chunks.push(data));
    const ended = once(client, 'end');
    client.write('fetch fixture');
    await new Promise(resolve => {
      setTimeout(resolve, 40);
    });
    client.resume();
    await ended;
    const received = Buffer.concat(chunks);
    expect(received.length).toBe(payload.length);
    expect(received.equals(payload)).toBe(true);
  } finally {
    client.destroy();
    bridge.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
    });
  }
});

it('separates WhatsApp failures from unrelated requests and bounds redacted history', async () => {
  const sockets = new Set<Socket>();
  let pageRequests = 0;
  const upstream = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let first = true;
    socket.on('data', data => {
      if (first) {
        first = false;
        socket.write(Buffer.from([5, 0]));
      } else {
        const page = data.subarray(5, -2).toString() === 'web.whatsapp.com';
        if (page) pageRequests += 1;
        const code = page ? (pageRequests === 1 ? 4 : 0) : 2;
        socket.write(Buffer.from([5, code, 0, 1, 127, 0, 0, 1, 0, 80]));
      }
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const bridge = await createSocksBridge(
    { ...defaultTools().proxy, host: '127.0.0.1', port: String(address.port) },
    '',
  );
  const request = async (host: string) => {
    const client = connect(bridge.port, '127.0.0.1');
    try {
      await once(client, 'connect');
      client.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
      await once(client, 'data');
    } finally {
      client.destroy();
    }
  };
  try {
    await request('web.whatsapp.com');
    // These may be Chromium background requests and must not overwrite the
    // separate WhatsApp failure with a claim about the failed main document.
    for (let i = 0; i < 14; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- Exercise successive independent tunnel failures.
      await request('private-background.example');
    }
    await request('web.whatsapp.com');
    const diagnostic = bridge.diagnostics();
    expect(diagnostic).toMatchObject({
      lastFailure: { target: 'other', code: 'REPLY_2' },
      lastWhatsAppFailure: { target: 'whatsapp-web', code: 'REPLY_4' },
      established: { 'whatsapp-web': 1, other: 0 },
    });
    expect(diagnostic.recentFailures).toHaveLength(12);
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-background|127\.0\.0\.1|web\.whatsapp\.com/,
    );
  } finally {
    bridge.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
    });
  }
});
