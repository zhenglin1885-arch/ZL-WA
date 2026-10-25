import {
  myMemorySource,
  translateMyMemory,
} from '../src/electron/myMemoryTranslation';

const success = (text: string) =>
  new Response(
    JSON.stringify({
      responseStatus: 200,
      responseData: { translatedText: text },
      quotaFinished: false,
    }),
  );
it('uses the account transport with no API key and decodes text entities safely', async () => {
  const transport = jest.fn(async () =>
    success('Hello &amp; thank you &#39;friend&#39;'),
  );
  const result = await translateMyMemory(transport, '你好', 'en', 'auto');
  expect(result).toEqual({
    text: "Hello & thank you 'friend'",
    error: false,
    provider: 'MyMemory',
  });
  const [url, init] = transport.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  const query = new URL(url);
  expect(query.origin).toBe('https://api.mymemory.translated.net');
  expect(query.searchParams.get('langpair')).toBe('zh-CN|en');
  expect(query.searchParams.get('q')).toBe('你好');
  expect(new Set(query.searchParams.keys())).toEqual(
    new Set(['langpair', 'q']),
  );
  expect(init.headers).toEqual({ Accept: 'application/json' });
  expect(init.method).toBe('GET');
});
it.each([
  ['Hello', 'en'],
  ['Oi', 'pt'],
  ['por que você não fala mano', 'pt'],
  ['please send me a message', 'en'],
  ['你好，请问你在吗？', 'zh-CN'],
  ['こんにちは', 'ja'],
  ['안녕하세요', 'ko'],
])('detects the source locally for %s', (text, expected) =>
  expect(myMemorySource(text, 'auto')).toBe(expected),
);
it('respects an explicit source and returns already-target-language text without a provider request', async () => {
  expect(myMemorySource('Hello', 'fr')).toBe('fr');
  const transport = jest.fn();
  expect(await translateMyMemory(transport, 'Hello', 'en', 'en')).toEqual({
    text: 'Hello',
    error: false,
    provider: 'MyMemory',
  });
  expect(transport).not.toHaveBeenCalled();
});
it('splits long Unicode captions below the byte limit and preserves every paragraph, blank line, emoji and whitespace', async () => {
  const text = `  ${'这是长图文说明和投资策略。👨‍👩‍👧‍👦 '.repeat(70)}\n\n  第二段说明 \r\n\n2026-10-25 17:22`;
  const queries: string[] = [];
  const transport = jest.fn(async (url: string) => {
    const q = new URL(url).searchParams.get('q')!;
    queries.push(q);
    expect(Buffer.byteLength(q, 'utf8')).toBeLessThanOrEqual(500);
    expect(q).not.toMatch(/[\uD800-\uDBFF]$/u);
    return success(q);
  });
  expect(await translateMyMemory(transport, text, 'en', 'zh-CN')).toEqual({
    text,
    error: false,
    provider: 'MyMemory',
  });
  expect(queries.length).toBeGreaterThan(2);
});
it.each([
  {
    responseStatus: 429,
    quotaFinished: true,
    responseData: { translatedText: 'MYMEMORY WARNING' },
  },
  {
    responseStatus: 200,
    quotaFinished: true,
    responseData: { translatedText: 'MYMEMORY WARNING' },
  },
  {
    responseStatus: 400,
    responseData: { translatedText: 'INVALID SOURCE LANGUAGE' },
  },
  { responseStatus: 200, responseData: { translatedText: '' } },
])('never presents quota/status errors as translations', async data => {
  const result = await translateMyMemory(
    async () => new Response(JSON.stringify(data)),
    'Hello',
    'zh-CN',
    'en',
  );
  expect(result).toMatchObject({ text: '', error: true, provider: 'MyMemory' });
});
it('discards partial results when a later chunk fails and hides transport secrets', async () => {
  const transport = jest
    .fn()
    .mockResolvedValueOnce(success('first chunk'))
    .mockRejectedValueOnce(new Error('proxy-password-and-message-secret'));
  const result = await translateMyMemory(
    transport,
    'long description '.repeat(70),
    'zh-CN',
    'en',
  );
  expect(result.error).toBe(true);
  expect(result.text).toBe('');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(transport).toHaveBeenCalledTimes(2);
});
it('does not send invalid or undetectable language pairs', async () => {
  const transport = jest.fn();
  expect(
    await translateMyMemory(transport, 'x', 'zh-CN', 'auto'),
  ).toMatchObject({ error: true, text: '' });
  expect(transport).not.toHaveBeenCalled();
});
