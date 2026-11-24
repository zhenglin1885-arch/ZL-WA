import { allowWhatsAppPersistentStorage } from '../src/electron/whatsappStoragePermission';

const official = 'https://web.whatsapp.com';
it.each([
  [official, official, undefined],
  [`${official}/login/`, `${official}/`, official],
  [official, undefined, official],
])(
  'allows official WhatsApp persistent storage including its worker origin (%s)',
  (requesting, top, embedding) => {
    expect(
      allowWhatsAppPersistentStorage(
        'persistent-storage',
        requesting,
        top,
        embedding,
      ),
    ).toBe(true);
  },
);

it.each([
  ['http://web.whatsapp.com', official, undefined],
  ['https://web.whatsapp.com.evil.invalid', official, undefined],
  ['https://web.whatsapp.com:8443', official, undefined],
  ['https://business.facebook.com', 'https://business.facebook.com', undefined],
  [official, 'https://unrelated.invalid', undefined],
  [official, official, 'https://unrelated.invalid'],
  ['null', official, undefined],
  ['', official, undefined],
  [undefined, official, undefined],
])(
  'does not grant persistent storage to other origins or unrelated embedding pages (%s)',
  (requesting, top, embedding) => {
    expect(
      allowWhatsAppPersistentStorage(
        'persistent-storage',
        requesting,
        top,
        embedding,
      ),
    ).toBe(false);
  },
);

it.each([
  'unknown',
  'geolocation',
  'storage-access',
  'top-level-storage-access',
  'fileSystem',
  'media',
  'notifications',
])(
  'leaves the existing %s permission policy to its original handler',
  permission => {
    expect(
      allowWhatsAppPersistentStorage(permission, official, official, official),
    ).toBe(false);
  },
);
