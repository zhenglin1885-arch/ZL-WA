import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';

type Handler = (...args: any[]) => any;

const root = join(__dirname, '../src/internal-server');

describe('local-only server boundary', () => {
  it('checks the real token before issuing a local browser cookie and removes remote import routes', async () => {
    const handlers = new Map<string, Handler>();
    const route: any = {
      get: (name: string, fn: Handler) => {
        handlers.set(name, fn);
        return route;
      },
      post: (name: string, fn: Handler) => {
        handlers.set(name, fn);
        return route;
      },
      put: () => route,
      delete: () => route,
      group: (fn: Handler) => {
        fn();
        return route;
      },
      prefix: () => route,
      middleware: () => route,
    };
    runInNewContext(readFileSync(join(root, 'start/routes.js'), 'utf8'), {
      Buffer,
      process: { env: { FERDIUM_LOCAL_TOKEN: 'correct-local-token' } },
      use: () => route,
      require: (name: string) => {
        if (name === 'node:crypto') return crypto;
        if (name.endsWith('environment-remote')) return { API_VERSION: 'v1' };
        if (name === './migrate') return () => {};
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    const response = {
      forbidden: jest.fn(),
      cookie: jest.fn(),
      redirect: jest.fn(),
    };
    const entry = handlers.get('token/:token')!;
    for (const token of ['', 'wrong', 'x'.repeat(200)])
      entry({ params: { token }, response });
    expect(response.forbidden).toHaveBeenCalledTimes(3);
    expect(response.cookie).not.toHaveBeenCalled();
    await entry({ params: { token: 'correct-local-token' }, response });
    expect(response.cookie).toHaveBeenCalledTimes(1);
    expect(response.redirect).toHaveBeenCalledWith('/');
    expect(handlers.has('import')).toBe(false);
    expect(handlers.has('export')).toBe(true);
    expect(handlers.has('transfer')).toBe(true);
  });

  it('serves catalogue, search and featured data without calling fetch or redirecting to upstream', async () => {
    const bundled = [
      { id: 'whatsapp', name: 'WhatsApp', featured: true },
      { id: 'telegram', name: 'Telegram', featured: false },
    ];
    const module = { exports: {} as any };
    const fetcher = jest.fn(() => {
      throw new Error('Network must not be used');
    });
    runInNewContext(
      readFileSync(
        join(root, 'app/Controllers/Http/RecipeController.js'),
        'utf8',
      ),
      {
        module,
        fetch: fetcher,
        use: (name: string) =>
          name === 'App/Models/Recipe'
            ? {
                all: async () => ({
                  rows: [
                    { recipeId: 'custom-local', name: 'Custom', data: '{}' },
                  ],
                }),
              }
            : { exists: async () => false },
        require: (name: string) => {
          if (name.endsWith('jsUtils')) return { convertToJSON: JSON.parse };
          if (name.endsWith('asar-helpers'))
            return { asarRecipesPath: () => '/bundled' };
          if (name.endsWith('local-recipes'))
            return {
              localRecipePreviews: () => bundled,
              validRecipeId: () => true,
            };
          throw new Error(`Unexpected dependency ${name}`);
        },
      },
    );
    const Controller = module.exports;
    const controller = new Controller();
    const response: any = {
      send: jest.fn(),
      status: jest.fn(() => response),
      redirect: jest.fn(),
    };
    await controller.list({ response });
    expect(response.send.mock.calls[0][0]).toHaveLength(3);
    await controller.search({ request: { input: () => 'tele' }, response });
    expect(response.send.mock.calls[1][0]).toEqual([bundled[1]]);
    await controller.popularRecipes({ response });
    expect(response.send.mock.calls[2][0]).toEqual([bundled[0]]);
    await controller.download({ params: { recipe: 'missing' }, response });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.redirect).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
