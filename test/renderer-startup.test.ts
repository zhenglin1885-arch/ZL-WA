import { startRendererWhenReady } from '../src/electron/rendererStartup';

jest.mock('electron', () => ({ ipcRenderer: { send: jest.fn() } }));

describe('renderer DOM readiness', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let documentTarget: EventTarget & { readyState: string };
  let windowTarget: EventTarget;
  beforeEach(() => {
    documentTarget = Object.assign(new EventTarget(), {
      readyState: 'loading',
    });
    windowTarget = new EventTarget();
    for (const [name, value] of Object.entries({
      document: documentTarget,
      window: windowTarget,
    })) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    originals.clear();
  });
  it('starts after DOM parsing even when an image or child frame prevents window.load', () => {
    const initialize = jest.fn();
    startRendererWhenReady(initialize);
    expect(initialize).not.toHaveBeenCalled();
    documentTarget.readyState = 'interactive';
    documentTarget.dispatchEvent(new Event('DOMContentLoaded'));
    expect(initialize).toHaveBeenCalledTimes(1);
    windowTarget.dispatchEvent(new Event('load'));
    documentTarget.dispatchEvent(new Event('DOMContentLoaded'));
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it.each(['interactive', 'complete'])(
    'starts immediately in a %s document',
    state => {
      documentTarget.readyState = state;
      const initialize = jest.fn();
      startRendererWhenReady(initialize);
      expect(initialize).toHaveBeenCalledTimes(1);
    },
  );
});
