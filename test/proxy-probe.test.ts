import { probeProxyDocument } from '../src/electron/proxyProbe';

it('reads the complete GET document rather than relying on HEAD success', async () => {
  const fetcher = jest.fn(
    async () =>
      new Response('<!doctype html><html></html>', {
        headers: { 'content-type': 'text/html' },
      }),
  );
  expect(await probeProxyDocument(fetcher)).toMatchObject({
    documentChecked: true,
    documentBytes: 28,
  });
  expect(fetcher).toHaveBeenCalledWith(
    'https://web.whatsapp.com/',
    expect.objectContaining({ method: 'GET', cache: 'no-store' }),
  );
});
it('rejects a reset body even after successful headers', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new Error('fixture-reset'));
    },
  });
  await expect(
    probeProxyDocument(
      async () =>
        new Response(body, { headers: { 'content-type': 'text/html' } }),
    ),
  ).rejects.toThrow('fixture-reset');
});
it('rejects proxy error pages with non-HTML content types', async () => {
  await expect(
    probeProxyDocument(
      async () =>
        new Response('proxy denied', {
          headers: { 'content-type': 'text/plain' },
        }),
    ),
  ).rejects.toThrow('未返回');
});
it('times out stalled document bodies and releases the deadline timer', async () => {
  jest.useFakeTimers();
  try {
    const pending = probeProxyDocument(
      async () =>
        new Response(new ReadableStream(), {
          headers: { 'content-type': 'text/html' },
        }),
      100,
    );
    const failed = pending.catch(error => error);
    await jest.advanceTimersByTimeAsync(100);
    await expect(failed).resolves.toMatchObject({
      message: '页面正文读取超时',
    });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
