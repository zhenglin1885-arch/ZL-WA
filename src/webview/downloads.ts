// Run in the main world before the site's feature detection. Electron exposes
// File System Access pickers whose handles cannot reliably createWritable().
// WhatsApp already supports standard browser downloads when this API is absent.
export function isWhatsAppMediaUrl(url: string, contentsUrl: string): boolean {
  try {
    if (new URL(contentsUrl).origin !== 'https://web.whatsapp.com')
      return false;
    const target = new URL(url);
    return (
      target.protocol === 'data:' ||
      (target.protocol === 'blob:' &&
        target.origin === 'https://web.whatsapp.com')
    );
  } catch {
    return false;
  }
}

export function configureWhatsAppDownloads(): boolean {
  if (
    globalThis.location.protocol !== 'https:' ||
    globalThis.location.hostname !== 'web.whatsapp.com'
  )
    return false;
  try {
    // Setting undefined still satisfies `"showSaveFilePicker" in window`.
    // Remove the property so both presence and callable feature checks select
    // the standard download path. The native API may live on a prototype.
    let owner: object | null = window;
    while (owner) {
      if (
        Object.hasOwn(owner, 'showSaveFilePicker') &&
        !Reflect.deleteProperty(owner, 'showSaveFilePicker')
      )
        return false;
      owner = Object.getPrototypeOf(owner);
    }
    return !('showSaveFilePicker' in window);
  } catch {
    return false;
  }
}

// Keep a delayed download's placeholder in the page world. Objects returned
// through contextBridge are frozen copies, so assigning popup.location there
// cannot notify the preload's original placeholder.
export function configureWhatsAppDownloadWindows(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  if (!page.ferdium?.downloadMedia) return false;
  const { open } = page;
  // eslint-disable-next-line unicorn/consistent-function-scoping -- Serialized main-world function must keep its helper local.
  const media = (value: string) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'data:' ||
        (url.protocol === 'blob:' && url.origin === 'https://web.whatsapp.com')
      );
    } catch {
      return false;
    }
  };
  page.open = (url?: string | URL, frameName?: string, features?: string) => {
    if (url) {
      if (media(String(url))) {
        page.ferdium.downloadMedia(String(url));
        return null;
      }
      return open(url, frameName, features);
    }
    const popup = {
      closed: false,
      opener: null,
      document: document.implementation.createHTMLDocument(''),
      close() {
        popup.closed = true;
      },
      focus() {},
    };
    let href = '';
    const navigate = (value: string) => {
      href = String(value);
      if (!href || popup.closed) return;
      if (media(href)) page.ferdium.downloadMedia(href);
      else open(href, frameName, features);
      popup.closed = true;
    };
    const destination = {
      get href() {
        return href;
      },
      set href(value: string) {
        navigate(value);
      },
      assign: navigate,
      replace: navigate,
    };
    Object.defineProperty(popup, 'location', {
      get: () => destination,
      set: navigate,
    });
    return popup;
  };
  return true;
}
