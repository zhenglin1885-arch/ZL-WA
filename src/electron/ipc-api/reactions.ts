import { app, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultReactionState,
  decodeReactionState,
  encodeReactionState,
} from '../../features/reactions/types';

export default function initReactions(
  check: (event: Electron.IpcMainInvokeEvent) => void,
) {
  const legacyPath = join(app.getPath('userData'), 'reaction-tools.json');
  const path = join(app.getPath('userData'), 'reaction-tools-v2.json');
  ipcMain.handle('reaction-tools-load', (event, format?: unknown) => {
    check(event);
    const source = existsSync(path) ? path : legacyPath;
    const state = existsSync(source)
      ? decodeReactionState(JSON.parse(readFileSync(source, 'utf8')))
      : defaultReactionState();
    return format === 'compact' ? encodeReactionState(state) : state;
  });
  ipcMain.handle('reaction-tools-save', (event, input: unknown) => {
    check(event);
    const next = encodeReactionState(decodeReactionState(input));
    writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    return true;
  });
}
