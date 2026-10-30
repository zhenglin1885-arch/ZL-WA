/* eslint-disable no-await-in-loop -- Verify bounded recognition failures sequentially. */
import { transcribeVoice } from '../src/electron/voiceTranscription';

function wav(samples = 2) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
it('uses Google Cloud Speech independently of Google text translation and keeps the key in a host header', async () => {
  const transport = jest.fn(async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    expect(headers.get('x-goog-api-key')).toBe('synthetic-secret');
    const body = JSON.parse(String(init.body));
    expect(body.config).toEqual({
      encoding: 'LINEAR16',
      sampleRateHertz: 16_000,
      audioChannelCount: 1,
      languageCode: 'pt-BR',
      enableAutomaticPunctuation: true,
    });
    expect(Buffer.from(body.audio.content, 'base64')).toEqual(wav());
    return Response.json({
      results: [{ alternatives: [{ transcript: ' Bom dia! ' }] }],
    });
  });
  expect(
    await transcribeVoice(
      transport,
      wav().toString('base64'),
      'synthetic-secret',
    ),
  ).toEqual({ text: 'Bom dia!', error: false });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(
    'https://speech.googleapis.com/v1/speech:recognize',
  );
});
it('splits audio above the synchronous duration limit without dropping or duplicating PCM', async () => {
  const original = wav(125 * 16_000);
  for (let i = 44; i < original.length; i += 1) original[i] = i % 251;
  const chunks: Buffer[] = [];
  const result = await transcribeVoice(
    async (_url, init) => {
      const body = JSON.parse(String(init.body));
      const chunk = Buffer.from(body.audio.content, 'base64');
      expect(chunk.length - 44).toBeLessThanOrEqual(55 * 32_000);
      expect(chunk.readUInt32LE(40)).toBe(chunk.length - 44);
      expect(body.config.languageCode).toBe('en-US');
      chunks.push(chunk.subarray(44));
      return Response.json({
        results: [{ alternatives: [{ transcript: `part${chunks.length}` }] }],
      });
    },
    original.toString('base64'),
    'key',
    'en-US',
  );
  expect(chunks.length).toBe(3);
  expect(Buffer.concat(chunks).equals(original.subarray(44))).toBe(true);
  expect(result).toEqual({ text: 'part1 part2 part3', error: false });
});
it('does not submit media without credentials, a valid language, valid WAV or within-limit data', async () => {
  const transport = jest.fn();
  const noKey = await transcribeVoice(transport, wav().toString('base64'), '');
  expect(noKey.error).toBe(true);
  const badLanguage = await transcribeVoice(
    transport,
    wav().toString('base64'),
    'key',
    'auto',
  );
  expect(badLanguage.error).toBe(true);
  for (const audio of [
    '',
    'https://example.invalid/audio',
    Buffer.from('not audio').toString('base64'),
    'A'.repeat(26_000_001),
  ]) {
    const result = await transcribeVoice(transport, audio, 'key');
    expect(result.error).toBe(true);
  }
  const broken = wav();
  broken.writeUInt32LE(48_000, 24);
  const result = await transcribeVoice(
    transport,
    broken.toString('base64'),
    'key',
  );
  expect(result.error).toBe(true);
  expect(transport).not.toHaveBeenCalled();
});
it.each([401, 403, 429, 500])(
  'reports provider HTTP %i without exposing response bodies',
  async status => {
    const result = await transcribeVoice(
      async () => new Response('synthetic-private-body', { status }),
      wav().toString('base64'),
      'key',
    );
    expect(result.error).toBe(true);
    expect(result.message).toContain(String(status));
    expect(JSON.stringify(result)).not.toContain('synthetic-private-body');
  },
);
it('does not expose transport errors or accept missing/oversized transcripts', async () => {
  const failed = await transcribeVoice(
    async () => {
      throw new Error('synthetic-secret');
    },
    wav().toString('base64'),
    'key',
  );
  expect(failed.error).toBe(true);
  expect(JSON.stringify(failed)).not.toContain('synthetic-secret');
  for (const data of [
    { results: [] },
    { error: { message: 'private' } },
    { results: [{ alternatives: [{ transcript: 'A'.repeat(12_001) }] }] },
  ]) {
    const result = await transcribeVoice(
      async () => Response.json(data),
      wav().toString('base64'),
      'key',
    );
    expect(result.error).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  }
});
