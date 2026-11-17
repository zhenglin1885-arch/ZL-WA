import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Exercise the shipped function after toString()/injection, with no access to
// the build module's helpers. Source-only tests cannot catch keepNames captures.
const file = 'src/features/accounts/facebook.ts';
const build = readFileSync(join(__dirname, '../esbuild.mjs'), 'utf8');
const entries = /const guestEntries = (\[[\s\S]*?\]);/.exec(build);
if (!entries) throw new Error('Cannot find the production guest build entries');
const guests: string[] = runInNewContext(entries[1]);
const compiled = transformSync(
  readFileSync(join(__dirname, '..', file), 'utf8'),
  {
    loader: 'ts',
    format: 'cjs',
    keepNames: !guests.includes(file),
    minifyIdentifiers: true,
    minifyWhitespace: true,
  },
).code;
const cjs = { exports: {} as Record<string, () => { status: string }> };
runInNewContext(compiled, { module: cjs, exports: cjs.exports });
const injected = `(${cjs.exports.readFacebookSnapshot.toString()})()`;

const page = (labels: string[], userId?: string) => ({
  location: { hostname: 'business.facebook.com', pathname: '/latest/home' },
  navigator: { onLine: true },
  window: {
    require: () => (userId === undefined ? undefined : { USER_ID: userId }),
  },
  getComputedStyle: () => ({ visibility: 'visible' }),
  document: {
    readyState: 'complete',
    querySelectorAll: (selector: string) =>
      /button|\[role="link"\]/.test(selector)
        ? labels.map(textContent => ({
            textContent,
            getClientRects: () => [{}],
            getAttribute: () => null,
          }))
        : [],
  },
});

describe('packaged Facebook status injection', () => {
  it('works in an isolated page after the actual guest build transformation', () => {
    expect(
      runInNewContext(injected, page(['Home', 'Inbox', 'Content', 'Planner']))
        .status,
    ).toBe('online');
    expect(
      runInNewContext(injected, page(['用 Facebook 继续', '用 Instagram 继续']))
        .status,
    ).toBe('logged-out');
    expect(runInNewContext(injected, page([], '123456789')).status).toBe(
      'online',
    );
    expect(runInNewContext(injected, page([], '0')).status).toBe('logged-out');
  });
  it('does not reuse authenticated state from another page', () => {
    expect(runInNewContext(injected, page([], '123456789')).status).toBe(
      'online',
    );
    expect(runInNewContext(injected, page([])).status).toBe('loading');
    expect(
      runInNewContext(injected, page(['用 Facebook 继续'], '123456789')).status,
    ).toBe('logged-out');
  });
});
