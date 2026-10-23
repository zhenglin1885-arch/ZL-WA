import { join } from 'node:path';
import {
  DEV_API_FRANZ_WEBSITE,
  DEV_FRANZ_API,
  DEV_WS_API,
  LIVE_API_FERDIUM_WEBSITE,
  LIVE_FERDIUM_API,
  LIVE_WS_API,
  LOCAL_API,
  LOCAL_API_WEBSITE,
  LOCAL_WS_API,
} from './config';
import { api as electronApi } from './electron-util';
import { isWindows } from './environment';
import { APP_NAME, APP_PROTOCOL, getProfilePath } from './app-identity';

export const { app } = electronApi;
export const ferdiumVersion: string = app.getVersion();
export const ferdiumLocale: string = app.getLocale();

export const isDevMode: boolean =
  process.env.ELECTRON_IS_DEV === undefined
    ? !app.isPackaged
    : Number.parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;

// ZL-WA modification: initialize our own profile before settings or sessions load.
app.setName(APP_NAME);
const profilePath = getProfilePath(
  isWindows && process.env.APPDATA
    ? process.env.APPDATA
    : app.getPath('appData'),
  isDevMode,
);
app.setPath('userData', profilePath);
// Renderer imports must not undo the main process's chosen browser-data directory.
if (process.type !== 'renderer') app.setPath('sessionData', profilePath);

export const userDataPath = (...segments: string[]): string => {
  return join(app.getPath('userData'), ...[segments].flat());
};

export const sessionDataPath = (...segments: string[]): string =>
  join(app.getPath('sessionData'), ...segments);

export const userDataRecipesPath = (...segments: string[]): string => {
  return userDataPath('recipes', ...[segments].flat());
};

export const userDataCertsPath = (...segments: string[]): string => {
  return userDataPath('certs', ...[segments].flat());
};

const useLocalAPI = process.env.USE_LOCAL_API;
export const useLiveAPI = process.env.USE_LIVE_API;

let api: string;
let wsApi: string;
let web: string;
if (!isDevMode || (isDevMode && useLiveAPI)) {
  api = LIVE_FERDIUM_API;
  wsApi = LIVE_WS_API;
  web = LIVE_API_FERDIUM_WEBSITE;
} else if (isDevMode && useLocalAPI) {
  api = LOCAL_API;
  wsApi = LOCAL_WS_API;
  web = LOCAL_API_WEBSITE;
} else {
  api = DEV_FRANZ_API;
  wsApi = DEV_WS_API;
  web = DEV_API_FRANZ_WEBSITE;
}

export const API: string = api;
export const API_VERSION: string = 'v1';
export const WS_API: string = wsApi;
export const WEBSITE: string = web;
// ZL-WA modification: do not register or intercept Ferdium's URL scheme.
export const protocolClient = isDevMode ? `${APP_PROTOCOL}-dev` : APP_PROTOCOL;
