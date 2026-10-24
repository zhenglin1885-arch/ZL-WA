/* eslint-disable jest/no-conditional-expect -- Each protocol/provider branch checks its distinct wire format. */
import { translateAccount } from '../src/electron/accountTranslation';

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
it.each([
  [
    'Google',
    [[['你好', 'hello']]],
    'https://translate.googleapis.com/translate_a/single',
  ],
  [
    'DeepL',
    { translations: [{ text: '你好' }] },
    'https://api-free.deepl.com/v2/translate',
  ],
  [
    'OpenAI',
    { output: [{ content: [{ type: 'output_text', text: '你好' }] }] },
    'https://api.openai.com/v1/responses',
  ],
  [
    'Gemini',
    { candidates: [{ content: { parts: [{ text: '你好' }] } }] },
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  ],
] as const)(
  'translates with %s through the injected account transport',
  async (engine, data, url) => {
    const transport = jest.fn(async () => response(data));
    expect(
      await translateAccount(
        transport,
        'hello',
        'zh-CN',
        engine,
        'auto',
        'synthetic-key',
      ),
    ).toEqual({ text: '你好', error: false });
    expect(transport).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'POST' }),
    );
    const init = (transport.mock.calls[0] as any)[1];
    if (engine === 'DeepL') {
      expect(init.headers.Authorization).toBe('DeepL-Auth-Key synthetic-key');
      expect(JSON.parse(init.body)).toEqual({
        text: ['hello'],
        target_lang: 'ZH',
      });
    }
    if (engine === 'OpenAI')
      expect(init.headers.Authorization).toBe('Bearer synthetic-key');
    if (engine === 'Gemini')
      expect(init.headers['x-goog-api-key']).toBe('synthetic-key');
  },
);
it('does not make a request without a required key and never echoes provider secrets/errors', async () => {
  const transport = jest.fn(async () =>
    response({ error: 'synthetic-secret' }, 401),
  );
  expect(
    await translateAccount(transport, 'hello', 'en', 'DeepL', 'auto'),
  ).toMatchObject({ error: true, message: expect.stringContaining('API Key') });
  expect(transport).not.toHaveBeenCalled();
  const result = await translateAccount(
    transport,
    'hello',
    'en',
    'DeepL',
    'auto',
    'synthetic-secret',
  );
  expect(result.message).toContain('401');
  expect(JSON.stringify(result)).not.toContain('synthetic-secret');
});
it('fails closed on unavailable or malformed providers', async () => {
  expect(
    await translateAccount(
      async () => {
        throw new Error('url with secret');
      },
      'hello',
      'en',
      'Google',
      'auto',
    ),
  ).toMatchObject({ error: true, text: '' });
  expect(
    await translateAccount(
      async () => response({}),
      'hello',
      'en',
      'Google',
      'auto',
    ),
  ).toMatchObject({ error: true, text: '' });
});

it('keeps every translated segment of a multiline Google caption', async () => {
  const caption =
    'Lucas Henrique Varella\nCEO | Oravion Capital\n\nGestão de riscos de portfólios de investimentos.';
  const transport = jest.fn(async (_url: string, init: RequestInit) => {
    expect(new URLSearchParams(init.body as string).get('q')).toBe(caption);
    return response([
      [
        ['卢卡斯\n', 'Lucas Henrique Varella\n'],
        ['首席执行官 | 欧瑞维资本\n\n', 'CEO | Oravion Capital\n\n'],
        [
          '投资组合风险管理。',
          'Gestão de riscos de portfólios de investimentos.',
        ],
      ],
    ]);
  });
  expect(
    await translateAccount(transport, caption, 'zh-CN', 'Google', 'auto'),
  ).toEqual({
    text: '卢卡斯\n首席执行官 | 欧瑞维资本\n\n投资组合风险管理。',
    error: false,
  });
});

it('reports Google no-key HTTP 429 as rate limiting without implying paid quota', async () => {
  const transport = jest.fn(async () => response({}, 429));
  const result = await translateAccount(
    transport,
    'hello',
    'zh-CN',
    'Google',
    'auto',
  );
  expect(result).toMatchObject({ error: true, text: '' });
  expect(result.message).toContain('429');
  expect(result.message).toContain('临时限流');
  expect(result.message).not.toContain('额度');
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(['12', new Date(Date.now() + 30_000).toUTCString(), 'invalid'])(
  'reports Google rate limits and parses Retry-After %s without exposing response data',
  async retry => {
    const result = await translateAccount(
      async () =>
        new Response('provider secret', {
          status: 429,
          headers: { 'Retry-After': retry },
        }),
      'hello',
      'zh-CN',
      'Google',
      'auto',
    );
    expect(result).toMatchObject({ error: true, text: '', rateLimited: true });
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain('provider secret');
    if (retry === '12') expect(result.retryAfterMs).toBe(12_000);
    if (retry === 'invalid') expect(result.retryAfterMs).toBe(0);
  },
);
