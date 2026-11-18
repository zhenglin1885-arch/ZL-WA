import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const prepareLibrary = require('../build-helpers/prepare-whatsapp-library.cjs');
const original = readFileSync(
  join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'),
  'utf8',
);
// Extract functions from the actual distributed SDK, without booting WhatsApp
// or replacing the SDK send API with a mock. Only the native provider is a fixture.
function sender(source: string, prefs: any) {
  const begin =
    source.indexOf('__webpack_modules__=') + '__webpack_modules__='.length;
  const end = source.indexOf(';const __webpack_module_cache__');
  if (begin < 22 || end <= begin)
    throw new Error('Unexpected SDK module table');
  const modules = runInNewContext(`(${source.slice(begin, end)})`);
  const entry = (name: string) => {
    const fn: any = Object.values(modules).find((f: any) =>
      f.toString().includes(`t.${name}=`),
    );
    if (!fn) throw new Error(`SDK module missing: ${name}`);
    return fn;
  };
  const lid = { server: 'lid', toString: () => '10001@lid' };
  const pn = { server: 'c.us', toString: () => '55111111111@c.us' };
  const id = {
    server: 'g.us',
    isGroup: () => true,
    isLid: () => false,
    isBot: () => false,
    toString: () => '10002@g.us',
  };
  const chat = { id };
  const delivered: any[] = [];
  class MsgKey {
    constructor(public props: any) {}
    toString() {
      return `true_${this.props.to}_abc`;
    }
  }
  const native = {
    UserPrefs: prefs,
    Wid: class {},
    ChatModel: class {},
    MsgKey,
  };
  Object.setPrototypeOf(chat, native.ChatModel.prototype);
  const conn: any = { getMyUserWid: () => pn };
  entry('getMyUserLid')({}, conn, () => native);
  const api: any = {};
  const functions = {
    unixTime: () => 123,
    getEphemeralFields: () => ({}),
    randomMessageId: () => 'abc',
    addAndSendMsgToChat: jest.fn(async (_chat: any, message: any) => {
      delivered.push(message);
      return [
        Promise.resolve({ ...message, ack: 1 }),
        Promise.resolve({ messageSendResult: 'OK' }),
      ];
    }),
  };
  const dependencies: Record<number, any> = {
    72927: conn,
    14647: native,
    20514: { ACK: { CLOCK: 0 } },
    52757: functions,
    74023: { defaultSendMessageOptions: {} },
    97829: api,
    41687: { assertFindChat: async () => chat, assertWid: (v: any) => v },
    17833: () => () => {},
  };
  const req = (key: number) => dependencies[key] || {};
  for (const name of [
    'generateMessageID',
    'prepareRawMessage',
    'sendRawMessage',
    'sendTextMessage',
  ])
    entry(name)({}, api, req);
  api.prepareMessageButtons = (message: any) => message;
  api.prepareLinkPreview = async (message: any) => message;
  return { api, chat, delivered, native, lid, pn, functions };
}

describe('production WhatsApp library compatibility', () => {
  it('reproduces the removed LID getter error in the unmodified shipped SDK', async () => {
    const env = sender(original, {
      getMaybeMeLidUser: () => ({ server: 'lid' }),
    });
    await expect(env.api.sendTextMessage(env.chat.id, 'test')).rejects.toThrow(
      'getMeLidUserOrThrow',
    );
    expect(env.functions.addAndSendMsgToChat).not.toHaveBeenCalled();
  });
  it('sends through the real SDK text, preparation and message-key pipeline with a modern LID getter', async () => {
    let env: ReturnType<typeof sender>;
    env = sender(prepareLibrary(original), {
      getMaybeMeLidUser: () => env.lid,
    });
    const result = await env.api.sendTextMessage(env.chat.id, 'test', {
      waitForAck: true,
    });
    expect(result.ack).toBe(1);
    expect(result.id).toBe('true_10002@g.us_abc');
    expect(env.delivered).toHaveLength(1);
    expect(env.delivered[0]).toMatchObject({
      body: 'test',
      from: env.lid,
      to: env.chat.id,
    });
    expect(env.delivered[0].id.props).toMatchObject({
      from: env.lid,
      participant: env.lid,
    });
  });
  it('also prepares media and retains the legacy getter on older native versions', async () => {
    let env: ReturnType<typeof sender>;
    env = sender(prepareLibrary(original), {
      getMeLidUserOrThrow: () => env.lid,
    });
    const result = await env.api.prepareRawMessage(env.chat, { type: 'ptt' });
    expect(result.from).toBe(env.lid);
    expect(result.id.props.participant).toBe(env.lid);
    expect(env.functions.addAndSendMsgToChat).not.toHaveBeenCalled();
  });
  it.each([undefined, { server: 'c.us' }])(
    'does not substitute a phone-number identity or submit if the LID is %s',
    async value => {
      const env = sender(prepareLibrary(original), {
        getMaybeMeLidUser: () => value,
      });
      await expect(
        env.api.sendTextMessage(env.chat.id, 'test'),
      ).rejects.toMatchObject({ code: 'ZL_LID_UNAVAILABLE' });
      expect(env.functions.addAndSendMsgToChat).not.toHaveBeenCalled();
    },
  );
  it('refuses to silently patch a different SDK build', () => {
    expect(() => prepareLibrary('different library')).toThrow(
      'Unexpected WhatsApp library',
    );
    expect(() => prepareLibrary(prepareLibrary(original))).toThrow(
      'Unexpected WhatsApp library',
    );
  });
});
