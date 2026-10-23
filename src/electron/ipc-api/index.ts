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
import processManager from './processManager';
import sessionStorage from './sessionStorage';
import settings from './settings';

export default (params: {
  mainWindow: BrowserWindow;
  settings: any;
  trayIcon: TrayIcon;
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
  languageDetect();
  dnd();
  focusState(params);
};
