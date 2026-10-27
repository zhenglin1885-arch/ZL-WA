import { isWhatsAppMediaUrl } from '../webview/downloads';

export function downloadWhatsAppPopup(
  contents: { getURL: () => string; downloadURL: (url: string) => void },
  url: string,
): boolean {
  if (!isWhatsAppMediaUrl(url, contents.getURL())) return false;
  // A blob belongs to this service session. Sending it to the external browser
  // loses that session and cannot download it.
  contents.downloadURL(url);
  return true;
}
