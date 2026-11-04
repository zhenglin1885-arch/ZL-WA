// Set only after the user starts installing a verified update, or the installer
// asks this running instance to quit. A normal close/quit keeps its preferences.
let requested = false;

export function prepareUpdateShutdown() {
  requested = true;
}

export function isUpdateShutdown() {
  return requested;
}
