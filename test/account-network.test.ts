import { probeAccountNetwork } from '../src/electron/AccountNetwork';

describe('account network probes', () => {
  it.each(['203.0.113.12', '2001:db8::12'])(
    'accepts public IPv4/IPv6 responses through the supplied transport: %s',
    async ip => {
      const fetcher = jest.fn(
        async (url: string) =>
          new Response(
            url.includes('cdn-cgi') ? `h=www.cloudflare.com\nip=${ip}\n` : null,
          ),
      );
      const result = await probeAccountNetwork(fetcher);
      expect(result.ip).toBe(ip);
      expect(result.milliseconds).toBeGreaterThanOrEqual(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenCalledWith(
        'https://web.whatsapp.com/',
        expect.objectContaining({
          method: 'HEAD',
          cache: 'no-store',
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );
  it('measures Meta Business Suite through the supplied Facebook transport', async () => {
    const fetcher = jest.fn(
      async (url: string) =>
        new Response(url.includes('cdn-cgi') ? 'ip=203.0.113.8' : null),
    );
    const result = await probeAccountNetwork(fetcher, 'facebook');
    expect(result).toMatchObject({ target: 'facebook', ip: '203.0.113.8' });
    expect(result.milliseconds).toBeGreaterThanOrEqual(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://business.facebook.com/',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(fetcher.mock.calls.some(([url]) => url.includes('whatsapp'))).toBe(
      false,
    );
  });
  it('keeps valid latency when the IP response is malformed', async () => {
    const result = await probeAccountNetwork(
      async url =>
        new Response(url.includes('cdn-cgi') ? 'ip=<invalid>' : null),
    );
    expect(result.ip).toBe('');
    expect(result.ipError).toContain('无效地址');
    expect(result.milliseconds).toBeGreaterThanOrEqual(1);
  });
  it('keeps valid IP when WhatsApp is unreachable', async () => {
    const result = await probeAccountNetwork(async url => {
      if (url.includes('whatsapp')) throw new Error('offline');
      return new Response('ip=203.0.113.4');
    });
    expect(result.ip).toBe('203.0.113.4');
    expect(result.milliseconds).toBeUndefined();
    expect(result.latencyError).toContain('offline');
  });
  it('reports HTTP failures without inventing IP or latency', async () => {
    const result = await probeAccountNetwork(
      async () => new Response(null, { status: 503 }),
    );
    expect(result.ip).toBe('');
    expect(result.milliseconds).toBeUndefined();
    expect(result.ipError).toContain('503');
    expect(result.latencyError).toContain('503');
  });
});
