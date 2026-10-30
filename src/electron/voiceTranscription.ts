/* eslint-disable no-await-in-loop -- Google requires sequential, bounded recognition chunks. */
// Speech credentials and provider requests stay in the privileged process.
type Transport = (url: string, init: RequestInit) => Promise<Response>;
export async function transcribeVoice(
  transport: Transport,
  audio: string,
  apiKey: string,
  language = 'pt-BR',
): Promise<{ text: string; error: boolean; message?: string }> {
  if (!apiKey)
    return {
      text: '',
      error: true,
      message:
        '请填写此账号的 Google Cloud 语音识别 API Key 并应用；文字翻译通道无需更改',
    };
  if (!/^[a-z]{2,3}-(?:[A-Z][a-z]{3}-)?[A-Z]{2}$/.test(language))
    return { text: '', error: true, message: '请选择有效的语音识别语言' };
  // Accept only the bounded mono 16 kHz PCM WAV produced by the guest decoder.
  if (
    typeof audio !== 'string' ||
    audio.length > 26_000_000 ||
    !/^[\d+/A-Za-z]+={0,2}$/.test(audio)
  )
    return { text: '', error: true, message: '语音数据无效或超过 10 分钟限制' };
  const bytes = Buffer.from(audio, 'base64');
  if (
    bytes.length < 46 ||
    bytes.length > 19_200_044 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== 16_000 ||
    bytes.readUInt32LE(28) !== 32_000 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString('ascii', 36, 40) !== 'data' ||
    bytes.readUInt32LE(40) !== bytes.length - 44 ||
    bytes.length % 2 !== 0
  )
    return {
      text: '',
      error: true,
      message: '语音格式无效，请重新读取该条语音',
    };
  try {
    const deadline = Date.now() + 180_000;
    const parts: string[] = [];
    // Google synchronous recognition accepts at most 60 seconds. Split longer
    // audio into <=55-second PCM chunks, preferring a quiet boundary after 45s.
    const pcm = bytes.subarray(44);
    let offset = 0;
    while (offset < pcm.length) {
      let end = Math.min(pcm.length, offset + 55 * 32_000);
      if (end < pcm.length) {
        let quietest = Number.POSITIVE_INFINITY;
        const limit = end;
        for (
          let position = offset + 45 * 32_000;
          position < limit;
          position += 3200
        ) {
          let energy = 0;
          for (let sample = position; sample < position + 3200; sample += 2)
            energy += Math.abs(pcm.readInt16LE(sample));
          if (energy < quietest) {
            quietest = energy;
            end = position + 3200;
          }
        }
      }
      const chunk = Buffer.concat([
        bytes.subarray(0, 44),
        pcm.subarray(offset, end),
      ]);
      chunk.writeUInt32LE(chunk.length - 8, 4);
      chunk.writeUInt32LE(chunk.length - 44, 40);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('识别超时');
      const response = await transport(
        'https://speech.googleapis.com/v1/speech:recognize',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16_000,
              audioChannelCount: 1,
              languageCode: language,
              enableAutomaticPunctuation: true,
            },
            audio: { content: chunk.toString('base64') },
          }),
          signal: AbortSignal.timeout(Math.min(60_000, remaining)),
          cache: 'no-store',
        },
      );
      if (!response.ok)
        return {
          text: '',
          error: true,
          message: `Google Cloud 语音识别 HTTP ${response.status}：请检查 API 是否开通、Key 限制、结算额度及网络连接`,
        };
      const data = await response.json();
      if (data.error)
        return {
          text: '',
          error: true,
          message: 'Google Cloud 语音识别未完成，请检查 API 权限和配额后重试',
        };
      for (const item of Array.isArray(data.results) ? data.results : []) {
        const text = item.alternatives?.[0]?.transcript;
        if (typeof text === 'string' && text.trim()) parts.push(text.trim());
      }
      if (parts.join(' ').length > 12_000)
        return {
          text: '',
          error: true,
          message: '语音转写超过 12000 字符，请使用较短语音',
        };
      offset = end;
    }
    const text = parts.join(' ');
    return text
      ? { text, error: false }
      : {
          text: '',
          error: true,
          message: '未识别到有效语音文字，请检查识别语言或音频内容',
        };
  } catch {
    return {
      text: '',
      error: true,
      message: '语音识别失败或超时，请检查连接后点击重试',
    };
  }
}
