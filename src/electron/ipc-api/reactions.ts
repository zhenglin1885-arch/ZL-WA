import { app, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultReactionState,
  validateReactionState,
} from '../../features/reactions/types';

export default function initReactions(
  check: (event: Electron.IpcMainInvokeEvent) => void,
) {
  const path = join(app.getPath('userData'), 'reaction-tools.json');
  ipcMain.handle('reaction-tools-load', event => {
    check(event);
    return existsSync(path)
      ? validateReactionState(JSON.parse(readFileSync(path, 'utf8')))
      : defaultReactionState();
  });
  ipcMain.handle('reaction-tools-save', (event, input: unknown) => {
    check(event);
    const next = validateReactionState(input);
    writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    return true;
  });
}
