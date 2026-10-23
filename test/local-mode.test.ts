import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  localRecipePreviews,
  validRecipeId,
} from '../src/helpers/local-recipes';

jest.mock('../src/config', () => ({
  LOCAL_HOSTNAME: 'localhost',
  SERVER_NOT_LOADED: 'not-ready',
}));
jest.mock('../src/environment-remote', () => ({
  API_VERSION: 'v1',
  ferdiumVersion: '7.2.10',
  ferdiumLocale: 'zh-CN',
}));
jest.mock('mobx-localstorage', () => ({ getItem: () => 'old-cloud-token' }));
const { default: apiBase, needsToken } = require('../src/api/apiBase');
const { sendAuthRequest } = require('../src/api/utils/auth');

describe('local-only application API', () => {
  let requests: { localServerPort: number; localServerToken?: string };
  let fetcher: jest.Mock;
  beforeEach(() => {
    requests = {
      localServerPort: 46_572,
      localServerToken: 'random-local-token',
    };
    fetcher = jest.fn(async () => new Response('{}'));
    (globalThis as any).window = {
      ferdium: {
        stores: {
          requests,
          settings: { all: { app: { server: 'https://api.ferdium.org' } } },
        },
      },
      fetch: fetcher,
    };
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });
  it('ignores a stale cloud server and uses the actual local port', () => {
    expect(apiBase()).toBe('http://localhost:46572/v1');
    expect(needsToken()).toBe(true);
    requests.localServerToken = undefined;
    expect(apiBase()).toBe('not-ready');
  });
  it.each([
    'https://api.ferdium.org/v1/me',
    'https://api.franzinfra.com/v1/me',
    'https://example.test/me',
    'http://localhost:46573/v1/me',
  ])('never sends credentials to %s', async url => {
    await expect(sendAuthRequest(url)).rejects.toThrow('本地模式');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends the startup token only to the matching local API', async () => {
    await sendAuthRequest(`${apiBase()}/me`);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:46572/v1/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Ferdium-Local-Token': 'random-local-token',
        }),
      }),
    );
  });
});

describe('bundled service catalogue', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'zl-local-catalogue-'));
    mkdirSync(join(directory, 'icons'));
    writeFileSync(join(directory, 'icons/whatsapp.svg'), '<svg/>');
    writeFileSync(
      join(directory, 'all.json'),
      JSON.stringify([
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          icons: { svg: 'https://cdn.example/icon.svg' },
        },
        {
          id: 'telegram',
          name: 'Telegram',
          icons: { svg: 'https://cdn.example/other.svg' },
        },
        { id: '../outside', name: 'unsafe' },
      ]),
    );
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it('loads the catalogue with local icons and never retains a CDN fallback', () => {
    expect(localRecipePreviews(directory)).toEqual([
      {
        id: 'whatsapp',
        name: 'WhatsApp',
        icons: {
          svg: pathToFileURL(join(directory, 'icons/whatsapp.svg')).href,
        },
      },
      { id: 'telegram', name: 'Telegram', icons: { svg: '' } },
    ]);
  });
  it('removes Teams entirely and retains Facebook Business with its own local icon', () => {
    writeFileSync(join(directory, 'icons/meta-business-suite.svg'), '<svg/>');
    writeFileSync(
      join(directory, 'all.json'),
      JSON.stringify([
        { id: 'msteams', name: 'Microsoft Teams', featured: true },
        {
          id: 'meta-business-suite',
          name: 'Meta Business Suite',
          featured: false,
        },
      ]),
    );
    const catalogue = localRecipePreviews(directory);
    expect(catalogue.find(r => r.id === 'msteams')).toBeUndefined();
    expect(catalogue.find(r => r.id === 'meta-business-suite')).toMatchObject({
      name: 'Facebook Business',
      featured: true,
      icons: {
        svg: pathToFileURL(join(directory, 'icons/meta-business-suite.svg'))
          .href,
      },
    });
  });
  it.each(['../x', '/tmp/x', 'a\\b', '..', 'a..b', ''])(
    'rejects non-local package ID %s',
    id => {
      expect(validRecipeId(id)).toBe(false);
    },
  );
});
