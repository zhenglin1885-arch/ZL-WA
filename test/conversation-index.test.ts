import { readConversationIndex } from '../src/features/conversations/guest';

describe('aggregate native conversation names', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('keeps saved, unsaved and group names separate from customer remarks, with a phone fallback', () => {
    const models = [
      {
        id: '10001@c.us',
        formattedTitle: 'Native title',
        contact: { isMyContact: true, name: 'Saved name' },
      },
      { id: '10002@c.us', formattedTitle: 'WhatsApp name' },
      { id: '10003@c.us', contact: { pushname: 'Push name' } },
      { id: '10004@c.us' },
      { id: '10005-123@g.us', formattedTitle: 'Group subject' },
    ];
    for (const [key, value] of Object.entries({
      location: { hostname: 'web.whatsapp.com' },
      window: {
        __zlCustomerAdapter: {
          owners: () => ['99999@c.us'],
          models: () => models,
        },
      },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
    expect(readConversationIndex().rows.map(row => row.name)).toEqual([
      'Saved name',
      'WhatsApp name',
      'Push name',
      '10004',
      'Group subject',
    ]);
  });
});
