/* eslint-disable no-await-in-loop, no-continue -- Translate chunks sequentially, preserve line order and abort the entire caption on failure. */
import { detect } from 'tinyld';

type Transport = (url: string, init: RequestInit) => Promise<Response>;
export interface MyMemoryResult {
  text: string;
  error: boolean;
  provider: 'MyMemory';
  message?: string;
}
const latinLanguages = [
  'en',
  'pt',
  'es',
  'fr',
  'de',
  'it',
  'nl',
  'da',
  'sv',
  'no',
  'fi',
  'pl',
  'cs',
  'ro',
  'hu',
  'tr',
  'vi',
  'id',
  'ms',
  'tl',
  'sw',
  'hr',
  'sq',
  'af',
  'ca',
  'et',
  'lt',
  'lv',
  'sl',
  'sk',
];
const common: Record<string, string> = {
  hello: 'en',
  hi: 'en',
  hey: 'en',
  yes: 'en',
  no: 'en',
  ok: 'en',
  okay: 'en',
  thanks: 'en',
  oi: 'pt',
  olá: 'pt',
  hola: 'es',
  bonjour: 'fr',
  ciao: 'it',
};
// MyMemory requires an explicit source language. Detect locally; never send an
// invalid auto|target pair or ask the user for another provider configuration.
export function myMemorySource(text: string, source: string): string {
  if (source !== 'auto') return source;
  const word = text
    .trim()
    .toLowerCase()
    .replaceAll(/[!?.,。！？]/gu, '');
  if (common[word]) return common[word];
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'ja';
  if (/\p{Script=Hangul}/u.test(text)) return 'ko';
  if (/\p{Script=Han}/u.test(text)) return 'zh-CN';
  const language = detect(
    text,
    /\p{Script=Latin}/u.test(text) &&
      !/[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}]/u.test(text)
      ? { only: latinLanguages }
      : undefined,
  );
  return language;
}
function chunks(line: string): string[] {
  const out: string[] = [];
  let current = '';
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const words = [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(line),
  ].flatMap(({ segment }) =>
    Buffer.byteLength(segment, 'utf8') <= 480
      ? [segment]
      : [...graphemes.segment(segment)].map(part => part.segment),
  );
  for (const segment of words) {
    if (Buffer.byteLength(segment, 'utf8') > 480)
      throw new Error('Invalid text segment');
    if (Buffer.byteLength(current + segment, 'utf8') > 480) {
      out.push(current);
      current = '';
    }
    current += segment;
  }
  if (current) out.push(current);
  return out;
}
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00A0',
  };
  return text.replaceAll(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] || match;
      const n =
        entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return n > 0 && n <= 0x10_ff_ff && !(n >= 0xd8_00 && n <= 0xdf_ff)
        ? String.fromCodePoint(n)
        : match;
    },
  );
}
export async function translateMyMemory(
  transport: Transport,
  text: string,
  target: string,
  source: string,
): Promise<MyMemoryResult> {
  try {
    const from = myMemorySource(text, source);
    if (
      !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(from) ||
      !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(target)
    )
      return {
        text: '',
        error: true,
        provider: 'MyMemory',
        message: '备用翻译暂时无法识别源语言，请稍后重试',
      };
    if (from.toLowerCase() === target.toLowerCase())
      return { text, error: false, provider: 'MyMemory' };
    const output: string[] = [];
    const deadline = Date.now() + 60_000;
    let nextRequestAt = 0;
    for (const line of text.split(/(\r?\n+)/u)) {
      if (!line || /^\s+$/u.test(line)) {
        output.push(line);
        continue;
      }
      for (const part of chunks(line)) {
        if (
          !/\p{L}/u.test(part) ||
          /^(?:https?:\/\/|www\.)\S+$/iu.test(part.trim())
        ) {
          output.push(part);
          continue;
        }
        const prefix = part.match(/^\s*/u)![0];
        const suffix = part.match(/\s*$/u)![0];
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', part.trim());
        url.searchParams.set('langpair', `${from}|${target}`);
        const pause = Math.max(0, nextRequestAt - Date.now());
        if (pause > 0)
          await new Promise(resolve => {
            setTimeout(resolve, pause);
          });
        const remaining = Math.min(12_000, deadline - Date.now());
        if (remaining <= 0) throw new Error('Translation deadline exceeded');
        nextRequestAt = Date.now() + 250;
        const response = await transport(url.href, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(remaining),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Provider unavailable');
        const data = await response.json();
        if (
          Number(data?.responseStatus) !== 200 ||
          data?.quotaFinished === true ||
          typeof data?.responseData?.translatedText !== 'string' ||
          !data.responseData.translatedText.trim()
        )
          throw new Error('Provider rejected translation');
        output.push(
          prefix +
            decodeEntities(data.responseData.translatedText.trim()) +
            suffix,
        );
      }
    }
    const translated = output.join('');
    if (!translated.trim()) throw new Error('Empty translation');
    return { text: translated, error: false, provider: 'MyMemory' };
  } catch {
    // Never display provider bodies or return a partially translated caption.
    return {
      text: '',
      error: true,
      provider: 'MyMemory',
      message: 'Google 暂时不可用，MyMemory 备用翻译也未成功，请稍后重试',
    };
  }
}
