import { accountStatus } from '../src/features/accounts/whatsapp';
import {
  isFacebookBusiness,
  readFacebookSnapshot,
} from '../src/features/accounts/facebook';

describe('Facebook Business login status', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const navigation =
    '[role="navigation"] a[href*="/latest/"], nav a[href*="/latest/"], a[href*="/latest/inbox"], a[href*="/latest/home"]';
  const login =
    'a[href*="facebook.com/login"], a[href*="/business/login"], a[href*="/login.php"]';
  let shown: Set<string>;
  let address: any;
  let doc: any;
  beforeEach(() => {
    shown = new Set();
    address = { hostname: 'business.facebook.com', pathname: '/latest/inbox' };
    doc = {
      readyState: 'complete',
      querySelectorAll: (selector: string) =>
        shown.has(selector) ? [{ getClientRects: () => [{}] }] : [],
    };
    for (const [key, value] of Object.entries({
      window: {},
      location: address,
      document: doc,
      navigator: { onLine: true },
      getComputedStyle: () => ({ visibility: 'visible' }),
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('recognizes Business recipes and custom Business URLs without changing WhatsApp', () => {
    expect(isFacebookBusiness({ recipe: { id: 'facebookbusiness' } })).toBe(
      true,
    );
    expect(
      isFacebookBusiness({
        recipe: { id: 'custom' },
        url: 'https://business.facebook.com/latest/inbox',
      }),
    ).toBe(true);
    expect(isFacebookBusiness({ recipe: { id: 'whatsapp' } })).toBe(false);
    expect(
      isFacebookBusiness({
        recipe: { id: 'custom' },
        url: 'https://business.facebook.com.evil.test/',
      }),
    ).toBe(false);
  });
  it('reports logged-in only with a visible Business workspace', () => {
    expect(readFacebookSnapshot().status).toBe('loading');
    shown.add(navigation);
    expect(readFacebookSnapshot().status).toBe('online');
    shown.clear();
    shown.add(login);
    expect(readFacebookSnapshot().status).toBe('logged-out');
  });
  it.each([
    '/login',
    '/login.php',
    '/business/login',
    '/checkpoint/',
    '/two_step_verification/',
  ])(
    'marks authentication page %s as not logged in even with stale navigation',
    path => {
      address.pathname = path;
      shown.add(navigation);
      expect(readFacebookSnapshot().status).toBe('logged-out');
    },
  );
  it('recognizes the Meta welcome screen login buttons without calling it online', () => {
    doc.querySelectorAll = (selector: string) =>
      selector === 'a, button, [role="link"], [role="button"]'
        ? [{ textContent: '用 Facebook 登录', getClientRects: () => [{}] }]
        : [];
    expect(readFacebookSnapshot().status).toBe('logged-out');
  });
  it('recognizes the screenshot Continue labels on links and buttons', () => {
    doc.querySelectorAll = (selector: string) =>
      selector === 'a, button, [role="link"], [role="button"]'
        ? [{ textContent: '用 Facebook 继续', getClientRects: () => [{}] }]
        : [];
    expect(readFacebookSnapshot().status).toBe('logged-out');
  });
  it('recognizes a Business workspace with button menus instead of href links', () => {
    doc.querySelectorAll = (selector: string) =>
      selector === 'a, button, [role="link"], [role="button"]'
        ? ['Home', 'Inbox', 'Content', 'Planner'].map(textContent => ({
            textContent,
            getClientRects: () => [{}],
          }))
        : [];
    expect(readFacebookSnapshot().status).toBe('online');
  });
  it('uses first-party session state for icon-only workspaces, and never overrides a visible login screen', () => {
    (window as any).require = () => ({ USER_ID: '12345678' });
    expect(readFacebookSnapshot().status).toBe('online');
    shown.add(login);
    expect(readFacebookSnapshot().status).toBe('logged-out');
    shown.clear();
    (window as any).require = () => ({ USER_ID: '0' });
    expect(readFacebookSnapshot().status).toBe('logged-out');
  });
  it('does not mark loading pages or an unrelated origin as logged in', () => {
    shown.add(navigation);
    doc.readyState = 'loading';
    expect(readFacebookSnapshot().status).toBe('loading');
    doc.readyState = 'complete';
    address.hostname = 'unrelated.test';
    expect(readFacebookSnapshot().status).toBe('loading');
  });
});

describe('Facebook card status during background frame loading', () => {
  const service = {
    recipe: { id: 'facebookbusiness' },
    isEnabled: true,
    isLoading: true,
    isError: false,
    hasCrashed: false,
    isHibernating: false,
    accountSnapshot: { status: 'online' as const },
  };
  it('keeps confirmed green/red states while child frames load but resets on main navigation', () => {
    expect(accountStatus(service)).toBe('online');
    expect(
      accountStatus({ ...service, accountSnapshot: { status: 'logged-out' } }),
    ).toBe('logged-out');
    expect(
      accountStatus({ ...service, accountSnapshot: { status: 'loading' } }),
    ).toBe('loading');
    expect(accountStatus({ ...service, recipe: { id: 'whatsapp' } })).toBe(
      'loading',
    );
    expect(accountStatus({ ...service, isError: true })).toBe('error');
    expect(accountStatus({ ...service, isHibernating: true })).toBe('sleeping');
  });
});
