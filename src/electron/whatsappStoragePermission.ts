// Electron 43 emits persistent-storage for both StorageManager and Storage Bucket
// persistence, although its bundled permission TypeScript union omits that value.
// This grants retention only; it neither creates nor reads any account data.
export function allowWhatsAppPersistentStorage(
  permission: string,
  requestingOrigin: string | undefined,
  topLevelUrl?: string,
  embeddingOrigin?: string,
): boolean {
  if (permission !== 'persistent-storage') return false;
  const official = (value: string | undefined) => {
    try {
      return new URL(value || '').origin === 'https://web.whatsapp.com';
    } catch {
      return false;
    }
  };
  return (
    official(requestingOrigin) &&
    (topLevelUrl === undefined || official(topLevelUrl)) &&
    (embeddingOrigin === undefined || official(embeddingOrigin))
  );
}
