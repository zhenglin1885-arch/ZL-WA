// Confirm the document body, not just a successful HEAD response. This does
// not assert that WhatsApp's subsequent resources or chat socket are ready.
export async function probeProxyDocument(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs = 12_000,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const operation = async () => {
    const response = await fetcher('https://web.whatsapp.com/', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`页面请求失败：HTTP ${response.status}`);
    if (
      !/text\/html|application\/xhtml\+xml/i.test(
        response.headers.get('content-type') || '',
      )
    )
      throw new Error('代理未返回可识别的 WhatsApp 网页');
    if (!response.body) throw new Error('页面正文为空');
    reader = response.body.getReader();
    let bytes = 0;
    let prefix = '';
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- Read the response stream in order, without buffering the whole document.
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 5_000_000)
        throw new Error('页面响应超过验证上限，未确认页面可加载');
      if (prefix.length < 65_536)
        prefix += new TextDecoder().decode(
          chunk.value.subarray(0, 65_536 - prefix.length),
        );
    }
    if (!bytes || !/<(?:!doctype\s+html|html\b)/i.test(prefix))
      throw new Error('未收到完整可识别的页面正文');
    const visibleHtml = prefix
      .replaceAll(/<script\b[\S\s]*?(?:<\/script\s*>|$)/gi, '')
      .replaceAll(/<style\b[\S\s]*?(?:<\/style\s*>|$)/gi, '')
      .replaceAll(/<!--[\S\s]*?(?:-->|$)/g, '');
    if (
      /<h[12]\b[^>]*>\s*(?:<[^>]+>\s*)*sorry,?\s+something went wrong\.?\s*(?:<[^>]+>\s*)*<\/h[12]\s*>/i.test(
        visibleHtml,
      )
    )
      throw new Error(
        'WhatsApp 返回临时错误页，尚未确认可加载聊天界面，请稍后重试',
      );
    return { documentChecked: true, documentBytes: bytes };
  };
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('页面正文读取超时'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    reader?.cancel().catch(() => {});
  }
}
