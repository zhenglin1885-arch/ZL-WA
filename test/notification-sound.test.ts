import type { playNotificationSound as Play } from '../src/features/accounts/notificationSound';

describe('local notification chime', () => {
  let play: typeof Play;
  let audio: any;
  let AudioMock: jest.Mock;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    jest.resetModules();
    audio = {
      play: jest.fn(() => Promise.resolve()),
      currentTime: 9,
      volume: 0,
    };
    AudioMock = jest.fn(() => audio);
    for (const [key, value] of Object.entries({
      Audio: AudioMock,
      window: { location: { href: 'file:///app/index.html' } },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    play = jest.requireActual<
      typeof import('../src/features/accounts/notificationSound')
    >('../src/features/accounts/notificationSound').playNotificationSound;
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  it('plays a bundled bell, coalesces bursts and reuses the audio element', () => {
    expect(play()).toBe(true);
    expect(AudioMock).toHaveBeenCalledWith(
      'file:///app/assets/sounds/ding-dong.wav',
    );
    expect(audio.currentTime).toBe(0);
    expect(audio.volume).toBe(0.65);
    expect(play()).toBe(false);
    jest.mocked(Date.now).mockReturnValue(11_201);
    expect(play()).toBe(true);
    expect(AudioMock).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it('never plays silent notifications and handles unavailable audio without blocking', async () => {
    expect(play(true)).toBe(false);
    expect(AudioMock).not.toHaveBeenCalled();
    audio.play.mockRejectedValue(new Error('no audio device'));
    expect(play()).toBe(true);
    await Promise.resolve();
  });
});
