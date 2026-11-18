export {};

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('mobx-react', () => ({ observer: (component: any) => component }));
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useState: jest.fn(),
}));
const { ipcRenderer } = require('electron');
const { useEffect, useState } = require('react');
const AccountNetworkStatus =
  require('../src/features/accountTools/AccountNetworkStatus').default;

const all = (node: any): any[] =>
  !node || typeof node !== 'object'
    ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(all)];

describe('title bar network status for active accounts', () => {
  let originalWindow: PropertyDescriptor | undefined;
  let originalReact: PropertyDescriptor | undefined;
  let states: any[];
  let hook: number;
  let cleanups: (() => void)[];
  const render = (service: any) => {
    hook = 0;
    return (AccountNetworkStatus as any)({
      stores: { services: { active: service } },
    });
  };
  const effect = () => {
    const run = (useEffect as jest.Mock).mock.calls.at(-1)[0];
    cleanups.push(run());
  };
  beforeEach(() => {
    jest.useFakeTimers();
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
    });
    originalReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
    Object.defineProperty(globalThis, 'React', {
      configurable: true,
      value: require('react'),
    });
    states = [];
    cleanups = [];
    (useState as jest.Mock).mockImplementation(initial => {
      const index = hook++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (next: any) => {
          states[index] =
            typeof next === 'function' ? next(states[index]) : next;
        },
      ];
    });
    (ipcRenderer.invoke as jest.Mock).mockResolvedValue({
      target: 'facebook',
      ip: '203.0.113.10',
      milliseconds: 45,
      checkedAt: 1,
    });
  });
  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    jest.useRealTimers();
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalReact)
      Object.defineProperty(globalThis, 'React', originalReact);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  it('enables Facebook probes, displays the result and forces another request on refresh', async () => {
    const service = {
      id: 'fb-1',
      name: 'FB',
      recipe: { id: 'facebook-business' },
      isEnabled: true,
      isHibernating: false,
      accountSnapshot: {},
    };
    const first = render(service);
    expect(
      all(first).find(n => n.type === 'button').props.disabled,
    ).toBeFalsy();
    effect();
    await Promise.resolve();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'account-tools-network-status',
      'fb-1',
      false,
      'facebook',
    );
    const ready = render(service);
    expect(ready.props.title).toContain('Meta Business Suite');
    expect(
      all(ready).find(n => n.props?.className === 'account-network-status__ip')
        .props.children,
    ).toContain('203.0.113.10');
    all(ready)
      .find(n => n.type === 'button')
      .props.onClick();
    cleanups.pop()!();
    render(service);
    effect();
    await Promise.resolve();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
      'account-tools-network-status',
      'fb-1',
      true,
      'facebook',
    );
  });
  it.each([
    {
      recipe: {
        id: 'custom',
        serviceURL: 'https://business.facebook.com/latest/',
      },
      expected: 'facebook',
    },
    { recipe: { id: 'whatsapp' }, expected: 'whatsapp' },
  ])(
    'recognizes a supported account by its recipe or Business URL',
    async ({ recipe, expected }) => {
      render({ id: 'account-1', recipe, isEnabled: true, accountSnapshot: {} });
      effect();
      await Promise.resolve();
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'account-tools-network-status',
        'account-1',
        false,
        expected,
      );
    },
  );
  it.each([
    { recipe: { id: 'facebook-business' }, isEnabled: false },
    {
      recipe: { id: 'facebook-business' },
      isEnabled: true,
      isHibernating: true,
    },
    { recipe: { id: 'unsupported' }, isEnabled: true },
  ])('keeps unavailable account refresh disabled', async values => {
    const view = render({ id: 'account-1', accountSnapshot: {}, ...values });
    expect(all(view).find(n => n.type === 'button').props.disabled).toBe(true);
    effect();
    await Promise.resolve();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});
