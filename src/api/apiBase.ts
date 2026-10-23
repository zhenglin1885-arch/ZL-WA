import { LOCAL_HOSTNAME, SERVER_NOT_LOADED } from '../config';
import { API_VERSION } from '../environment-remote';

// Never route application account/service/workspace data to a configured cloud.
export default function apiBase(withVersion = true) {
  const requests = (window as any).ferdium?.stores.requests;
  if (!requests?.localServerToken) return SERVER_NOT_LOADED;
  const origin = `http://${LOCAL_HOSTNAME}:${requests.localServerPort}`;
  return withVersion ? `${origin}/${API_VERSION}` : origin;
}
export const needsToken = (): boolean => true;
export const localServerToken = (): string | undefined =>
  (window as any).ferdium?.stores.requests?.localServerToken;
export const importExportURL = () =>
  `${apiBase(false)}/token/${localServerToken()}`;
export const serverBase = () => apiBase(false);
export const serverName = (): string => 'Local';
