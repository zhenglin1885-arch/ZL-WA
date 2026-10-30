import { defaultTools } from '../src/features/accountTools/config';
import {
  translationTick,
  translationResult,
} from '../src/features/accountTools/guest';
import {
  voiceTranslationTick,
  readVoiceTranslationAudio,
  voiceTranslationCurrent,
  voiceTranslationResult,
} from '../src/features/accountTools/voiceTranslationGuest';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  getBulkQueue: () => ({ start() {}, dispose() {} }),
  ensureBulkLibrary: jest.fn(async () => {}),
}));
const { ipcRenderer } = require('electron');
const { startTranslations } = require('../src/features/accountTools/runtime');
const {
  ensureBulkLibrary,
} = require('../src/features/accountTools/bulkRuntime');

let stop: () => void;
afterEach(() => {
  stop?.();
  jest.useRealTimers();
});
function fixture(failVoiceScan = false, failCredentials = false) {
  jest.useFakeTimers();
  const config = defaultTools();
  config.translation.incoming = true;
  const job = { id: 'false_10001@c.us_AUDIO', token: 'document-1' };
  const executeJavaScript = jest.fn(async (script: string) => {
    if (script.startsWith(`(${translationTick.toString()})`))
      return [
        {
          id: 1,
          token: 'document-1',
          text: 'A text message',
          direction: 'incoming',
        },
      ];
    if (script.startsWith(`(${voiceTranslationTick.toString()})`)) {
      if (failVoiceScan) throw new Error('Unsupported voice markup');
      return [job];
    }
    if (script.startsWith(`(${readVoiceTranslationAudio.toString()})`))
      return { audio: 'synthetic-audio' };
    if (script.startsWith(`(${voiceTranslationCurrent.toString()})`))
      return true;
    if (script.startsWith(`(${voiceTranslationResult.toString()})`))
      return true;
    if (script.startsWith(`(${translationResult.toString()})`)) return false;
    throw new Error('Unexpected guest execution');
  });
  const service = {
    id: 'account-1',
    recipe: { id: 'whatsapp' },
    webview: { executeJavaScript },
  };
  const invoke = ipcRenderer.invoke as jest.Mock;
  invoke.mockImplementation(async (name: string) => {
    if (name === 'account-tools-get') return config;
    if (name === 'account-tools-voice-ready') {
      if (failCredentials) throw new Error('Missing Google Cloud Key');
      return true;
    }
    if (name === 'account-tools-transcribe')
      return { text: 'Bom dia', error: false };
    if (name === 'account-tools-translate')
      return { text: '早上好', error: false };
    throw new Error('Unexpected IPC');
  });
  stop = startTranslations({
    services: { all: [service], active: service },
    settings: { app: {} },
  } as any);
  return { executeJavaScript, invoke };
}
it('continues translating drained text jobs when voice decoration fails', async () => {
  const { invoke } = fixture(true);
  await jest.advanceTimersByTimeAsync(400);
  expect(invoke).toHaveBeenCalledWith(
    'account-tools-translate',
    'account-1',
    'A text message',
    'incoming',
    false,
  );
  expect(invoke).not.toHaveBeenCalledWith(
    'account-tools-transcribe',
    expect.anything(),
    expect.anything(),
  );
});
it('checks speech credentials before downloading any audio and shows a retryable error', async () => {
  const { executeJavaScript } = fixture(false, true);
  await jest.advanceTimersByTimeAsync(400);
  expect(ensureBulkLibrary).not.toHaveBeenCalled();
  expect(
    executeJavaScript.mock.calls.some(([script]) =>
      script.startsWith(`(${readVoiceTranslationAudio.toString()})`),
    ),
  ).toBe(false);
  expect(
    executeJavaScript.mock.calls.some(
      ([script]) =>
        script.startsWith(`(${voiceTranslationResult.toString()})`) &&
        script.includes('Missing Google Cloud Key'),
    ),
  ).toBe(true);
});
it('passes the recognized transcript through the existing incoming text translator', async () => {
  const { invoke, executeJavaScript } = fixture();
  await jest.advanceTimersByTimeAsync(400);
  expect(invoke).toHaveBeenCalledWith(
    'account-tools-transcribe',
    'account-1',
    'synthetic-audio',
  );
  expect(invoke).toHaveBeenCalledWith(
    'account-tools-translate',
    'account-1',
    'Bom dia',
    'incoming',
  );
  expect(
    executeJavaScript.mock.calls.some(
      ([script]) =>
        script.startsWith(`(${voiceTranslationResult.toString()})`) &&
        script.includes('早上好') &&
        script.includes('Bom dia'),
    ),
  ).toBe(true);
});
