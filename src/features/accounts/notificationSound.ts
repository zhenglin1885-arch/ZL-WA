/* eslint-disable no-void -- Sound playback failures are handled without interrupting notifications. */
// Shared application sound: local asset, one short chime per notification burst.
let audio: HTMLAudioElement | undefined;
let lastPlayed = Number.NEGATIVE_INFINITY;
export function playNotificationSound(silent = false): boolean {
  if (silent || Date.now() - lastPlayed < 1200) return false;
  try {
    audio ??= new Audio(
      new URL('assets/sounds/ding-dong.wav', window.location.href).href,
    );
    audio.volume = 0.65;
    audio.currentTime = 0;
    lastPlayed = Date.now();
    void audio.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
