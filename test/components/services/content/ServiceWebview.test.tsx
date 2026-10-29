import type ServiceWebviewClass from '../../../../src/components/services/content/ServiceWebview';

type Listener = (...args: any[]) => void;

type MockWebviewElement = {
  addEventListener: jest.Mock;
  blur: jest.Mock;
  focus: jest.Mock;
  getTitle: jest.Mock;
  listenerCount: (eventName: string) => number;
  removeEventListener: jest.Mock;
};

function mockCreateDebugLogger() {
  return jest.fn();
}

function mockObserver<T>(component: T): T {
  return component;
}

function createMockWebviewElement(): MockWebviewElement {
  const listeners = new Map<string, Listener[]>();

  return {
    addEventListener: jest.fn((eventName: string, listener: Listener) => {
      const eventListeners = listeners.get(eventName) ?? [];
      eventListeners.push(listener);
      listeners.set(eventName, eventListeners);
    }),
    blur: jest.fn(),
    focus: jest.fn(),
    getTitle: jest.fn(() => 'Page Title'),
    listenerCount(eventName: string) {
      return listeners.get(eventName)?.length ?? 0;
    },
    removeEventListener: jest.fn((eventName: string, listener: Listener) => {
      const eventListeners = listeners.get(eventName) ?? [];
      listeners.set(
        eventName,
        eventListeners.filter(currentListener => currentListener !== listener),
      );
    }),
  };
}

function createMockWebview(view: MockWebviewElement) {
  return { view };
}

function createProps() {
  const service = {
    _webview: null,
    dialogTitle: '',
    id: 'service-a',
    isActive: false,
    name: 'Service A',
  };

  return {
    detachService: jest.fn(),
    isSpellcheckerEnabled: false,
    service,
    setWebviewReference: jest.fn(),
  };
}

jest.mock('mobx-react', () => ({
  observer: mockObserver,
}));
jest.mock('react-electron-web-view', () => 'webview');
jest.mock('electron', () => ({
  ipcRenderer: { invoke: jest.fn().mockImplementation(async () => ({})) },
}));
jest.mock('../../../../src/preload-safe-debug', () => mockCreateDebugLogger);

const ServiceWebview = jest.requireActual<
  typeof import('../../../../src/components/services/content/ServiceWebview')
>('../../../../src/components/services/content/ServiceWebview').default;

describe('ServiceWebview', () => {
  it('keeps an already loaded WhatsApp page alive while history sync exceeds the startup budget', () => {
    jest.useFakeTimers();
    const props = createProps();
    Object.assign(props.service, {
      recipe: { id: 'whatsapp' },
      isLoading: false,
      accountSnapshot: { status: 'loading' },
    });
    const onStartupReady = jest.fn();
    const component = new ServiceWebview({
      ...props,
      onStartupReady,
    } as any) as ServiceWebviewClass;
    const view = Object.assign(createMockWebviewElement(), {
      stop: jest.fn(),
      executeJavaScript: jest.fn(async () => false),
    });
    component._setWebview(createMockWebview(view) as any);
    try {
      component.componentDidMount();
      jest.advanceTimersByTime(45_001);
      expect(view.stop).not.toHaveBeenCalled();
      expect(component.startupError).toBe(false);
      expect(onStartupReady).toHaveBeenCalledTimes(1);
    } finally {
      component.componentWillUnmount();
      jest.useRealTimers();
    }
  });
  it('waits for proxy preparation before navigating and keeps accounts isolated under shared-session settings', async () => {
    // esbuild-runner uses classic JSX; the real renderer supplies global React.
    const originalReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
    Object.defineProperty(globalThis, 'React', {
      configurable: true,
      value: jest.requireActual('react'),
    });
    const props = createProps();
    Object.assign(props.service, {
      recipe: { id: 'whatsapp' },
      partition: 'persist:shared',
    });
    const component = new ServiceWebview({
      ...props,
      stores: {
        settings: { app: { sandboxServices: false } },
        app: { sandboxServices: [] },
      },
    } as any) as ServiceWebviewClass;
    try {
      expect(component.render().props.partition).toBeUndefined();
      component.componentDidMount();
      await Promise.resolve();
      expect(
        jest.requireMock('electron').ipcRenderer.invoke,
      ).toHaveBeenCalledWith('account-tools-prepare', 'service-a');
      expect(component.render().props.partition).toBe(
        'persist:service-service-a',
      );
    } finally {
      component.componentWillUnmount();
      if (originalReact)
        Object.defineProperty(globalThis, 'React', originalReact);
      else Reflect.deleteProperty(globalThis, 'React');
    }
  });

  it('mounts the split handle before unread adapters that may fail after WhatsApp changes', async () => {
    const props = createProps();
    Object.assign(props.service, {
      recipe: { id: 'whatsapp' },
      accountSnapshot: { status: 'online' },
    });
    const component = new ServiceWebview(props as any) as ServiceWebviewClass;
    const view = Object.assign(createMockWebviewElement(), {
      executeJavaScript: jest.fn(async (code: string) => {
        if (code.includes('watchWhatsAppUnread'))
          throw new Error('Unread module not ready');
        return true;
      }),
    });
    component._setWebview(createMockWebview(view) as any);
    try {
      await component.pollAccount();
      expect(view.executeJavaScript).toHaveBeenCalledTimes(3);
      expect(view.executeJavaScript.mock.calls[0][0]).toContain(
        'configureWhatsAppLayout',
      );
      expect(view.executeJavaScript.mock.calls[1][0]).toContain(
        'configureWhatsAppVoice',
      );
      expect(view.executeJavaScript.mock.calls[2][0]).toContain(
        'watchWhatsAppUnread',
      );
    } finally {
      component.componentWillUnmount();
    }
  });

  it('does not steal keyboard focus from an open account menu or dialog', () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { querySelector: () => ({}) },
    });
    const props = createProps();
    props.service.isActive = true;
    const component = new ServiceWebview(props as any) as ServiceWebviewClass;
    const view = createMockWebviewElement();
    component._setWebview(createMockWebview(view) as any);
    try {
      component.refocusWebview();
      expect(view.focus).not.toHaveBeenCalled();
    } finally {
      component.componentWillUnmount();
      if (originalDocument)
        Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('moves webview listeners from old webview to replacement webview', () => {
    const component = new ServiceWebview(
      createProps() as any,
    ) as ServiceWebviewClass;
    const firstView = createMockWebviewElement();
    const secondView = createMockWebviewElement();

    component._setWebview(createMockWebview(firstView) as any);
    component._setWebview(createMockWebview(secondView) as any);

    expect(firstView.listenerCount('console-message')).toBe(0);
    expect(firstView.listenerCount('did-navigate')).toBe(0);
    expect(firstView.listenerCount('did-stop-loading')).toBe(0);
    expect(secondView.listenerCount('console-message')).toBe(1);
    expect(secondView.listenerCount('did-navigate')).toBe(1);
    expect(secondView.listenerCount('did-stop-loading')).toBe(1);
  });

  it('does not duplicate listeners when the same webview is set twice', () => {
    const component = new ServiceWebview(
      createProps() as any,
    ) as ServiceWebviewClass;
    const view = createMockWebviewElement();
    const webview = createMockWebview(view);

    component._setWebview(webview as any);
    component._setWebview(webview as any);

    expect(view.listenerCount('console-message')).toBe(1);
    expect(view.listenerCount('did-navigate')).toBe(1);
    expect(view.listenerCount('did-stop-loading')).toBe(1);
  });

  it('removes listeners and detaches service on unmount', () => {
    const props = createProps();
    const component = new ServiceWebview(props as any) as ServiceWebviewClass;
    const view = createMockWebviewElement();

    component._setWebview(createMockWebview(view) as any);
    component.componentWillUnmount();

    expect(view.listenerCount('console-message')).toBe(0);
    expect(view.listenerCount('did-navigate')).toBe(0);
    expect(view.listenerCount('did-stop-loading')).toBe(0);
    expect(props.detachService).toHaveBeenCalledWith({
      service: props.service,
    });
  });

  it('cancels a pending did-attach update on unmount', () => {
    jest.useFakeTimers();
    const props = createProps();
    const component = new ServiceWebview(props as any) as ServiceWebviewClass;

    component.handleDidAttach();
    component.componentWillUnmount();
    jest.runOnlyPendingTimers();

    expect(props.setWebviewReference).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
