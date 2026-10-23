import type { BrowserWindow } from 'electron';
import type TrayIcon from '../../lib/Tray';
import appIndicator from './appIndicator';
import accountTools from './accountTools';
import customers from './customers';

import autoUpdate from './autoUpdate';
import clipboard from './clipboard';
import dnd from './dnd';
import download from './download';
import focusState from './focusState';
import languageDetect from './languageDetect';
import localServer from './localServer';
import localDiagnostics from './localDiagnostics';
import chatBackup from './chatBackup';
import cacheLocation from './cacheLocation';
import type CacheLocation from '../CacheLocation';
import processManager from './processManager';
import sessionStorage from './sessionStorage';
import settings from './settings';

export default (params: {
  mainWindow: BrowserWindow;
  settings: any;
  trayIcon: TrayIcon;
  cacheLocation: CacheLocation;
}) => {
  settings(params);
  accountTools(params);
  customers(params.mainWindow);
  sessionStorage();
  autoUpdate(params);
  appIndicator(params);
  clipboard();
  download(params);
  processManager();
  localServer(params);
  localDiagnostics(params.mainWindow);
  chatBackup(params.mainWindow);
  cacheLocation(params.mainWindow, params.cacheLocation);
  languageDetect();
  dnd();
  focusState(params);
};
