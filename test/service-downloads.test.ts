import { downloadWhatsAppPopup } from '../src/electron/serviceDownloads';
import { configureWhatsAppDownloads } from '../src/webview/downloads';

describe('WhatsApp download compatibility', () => {
  it.each([
    'blob:https://web.whatsapp.com/media-id',
    'data:audio/ogg;base64,T2dnUw==',
  ])('downloads local media through its originating webContents', url => {
    const downloadURL = jest.fn();
    expect(
      downloadWhatsAppPopup(
        { getURL: () => 'https://web.whatsapp.com/', downloadURL },
        url,
      ),
    ).toBe(true);
    expect(downloadURL).toHaveBeenCalledTimes(1);
    expect(downloadURL).toHaveBeenCalledWith(url);
  });
  it.each([
    'https://example.com/file.pdf',
    'blob:https://example.com/id',
    'https://accounts.google.com/login',
    'about:blank',
    'invalid',
  ])('preserves regular links and OAuth handling', url => {
    const downloadURL = jest.fn();
    expect(
      downloadWhatsAppPopup(
        { getURL: () => 'https://web.whatsapp.com/', downloadURL },
        url,
      ),
    ).toBe(false);
    expect(downloadURL).not.toHaveBeenCalled();
  });
  it('does not change other services', () => {
    const downloadURL = jest.fn();
    expect(
      downloadWhatsAppPopup(
        { getURL: () => 'https://example.com/', downloadURL },
        'data:audio/ogg;base64,T2dnUw==',
      ),
    ).toBe(false);
    expect(downloadURL).not.toHaveBeenCalled();
  });
  describe('file picker feature detection', () => {
    const globals = new Map<string, PropertyDescriptor | undefined>();
    let page: any;
    beforeEach(() => {
      page = { showSaveFilePicker: jest.fn(), showOpenFilePicker: jest.fn() };
      for (const [key, value] of Object.entries({
        window: page,
        location: { hostname: 'web.whatsapp.com', protocol: 'https:' },
      })) {
        globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    });
    afterEach(() => {
      for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
      }
      globals.clear();
    });
    it('selects the standard download fallback without changing file uploads', () => {
      const open = page.showOpenFilePicker;
      expect(configureWhatsAppDownloads()).toBe(true);
      expect(typeof page.showSaveFilePicker).toBe('undefined');
      expect(page.showOpenFilePicker).toBe(open);
      expect(configureWhatsAppDownloads()).toBe(true);
    });
    it('leaves other services untouched', () => {
      (globalThis.location as any).hostname = 'example.com';
      const save = page.showSaveFilePicker;
      expect(configureWhatsAppDownloads()).toBe(false);
      expect(page.showSaveFilePicker).toBe(save);
    });
    it('handles locked properties without disrupting the preload', () => {
      Object.defineProperty(page, 'showSaveFilePicker', {
        configurable: false,
        value: page.showSaveFilePicker,
      });
      expect(configureWhatsAppDownloads()).toBe(false);
    });
  });
});
