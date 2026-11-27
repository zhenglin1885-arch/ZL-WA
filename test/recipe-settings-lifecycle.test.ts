import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { action, autorun, computed, makeObservable, observable } from 'mobx';

function controllerFixture(rootPresent = false) {
  const listeners = new Map<string, Set<() => void>>();
  let root: object | null = rootPresent ? {} : null;
  const document = {
    get documentElement() {
      return root;
    },
    addEventListener: (name: string, callback: () => void) => {
      const current = listeners.get(name) || new Set<() => void>();
      current.add(callback);
      listeners.set(name, current);
    },
    removeEventListener: (name: string, callback: () => void) => {
      listeners.get(name)?.delete(callback);
    },
  };
  const disable = jest.fn(() => {
    if (!root)
      throw new TypeError(
        'Cannot read properties of null (reading removeAttribute)',
      );
  });
  const enable = jest.fn();
  const file = ts.createSourceFile(
    'recipe.ts',
    readFileSync('src/webview/recipe.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const node = file.statements.find(
    statement =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === 'RecipeController',
  )!;
  const compiled = ts.transpileModule(
    `${node.getText(file)}\nglobalThis.Controller = RecipeController;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  ).outputText;
  const context: any = {
    action,
    autorun,
    computed,
    makeObservable,
    observable,
    document,
    DEFAULT_APP_SETTINGS: {
      enableSpellchecking: false,
      spellcheckerLanguage: '',
      universalDarkMode: false,
    },
    AutomaticLanguageDetection: class {
      disable() {}

      destroy() {}
    },
    FindInPage: class {},
    debug: () => {},
    contextMenu: () => {},
    ipcRenderer: { on: jest.fn(), sendToHost: jest.fn() },
    setTimeout: jest.fn(),
    window: {
      addEventListener: jest.fn(),
      location: { host: 'web.whatsapp.com' },
    },
    disableDarkMode: disable,
    enableDarkMode: enable,
    removeDarkModeStyle: jest.fn(),
    isDarkModeStyleInjected: () => false,
    darkModeStyleExists: () => false,
    ignoreList: [],
    customDarkModeCss: {},
    injectDarkModeStyle: jest.fn(),
    notificationsHandler: { dispose: jest.fn() },
    getSpellcheckerLocaleByFuzzyIdentifier: jest.fn(),
    switchDict: jest.fn(),
    ifUndefined: (value: any, fallback: any) =>
      value === undefined ? fallback : value,
  };
  vm.runInNewContext(compiled, context);
  const instance = new context.Controller();
  return {
    instance,
    disable,
    enable,
    ready() {
      root = {};
      for (const callback of listeners.get('DOMContentLoaded') || [])
        callback();
    },
    listeners,
  };
}

it('defers preload theme cleanup until the document exists, then applies the latest settings and keeps reacting', () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const f = controllerFixture();
  try {
    f.instance.update();
    f.instance.updateAppSettings(null, {
      darkMode: true,
      universalDarkMode: true,
    });
    f.instance.updateServiceSettings(null, {
      isDarkModeEnabled: true,
      recipe: { path: 'qa' },
      darkReaderSettings: { brightness: 90, contrast: 95, sepia: 0 },
    });
    expect(f.disable).not.toHaveBeenCalled();
    expect(f.enable).not.toHaveBeenCalled();
    f.ready();
    expect(f.enable).toHaveBeenCalledTimes(1);
    expect(f.enable.mock.calls[0][0]).toMatchObject({
      brightness: 90,
      contrast: 95,
    });
    f.instance.updateServiceSettings(null, { isDarkModeEnabled: false });
    expect(f.disable).toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  } finally {
    f.instance.destroy();
    errors.mockRestore();
    warnings.mockRestore();
  }
});

it('initializes immediately when a document exists and stops reacting after teardown', () => {
  const f = controllerFixture(true);
  expect(f.disable).toHaveBeenCalledTimes(1);
  f.instance.destroy();
  f.disable.mockClear();
  f.instance.updateAppSettings(null, { searchEngine: 'changed' });
  expect(f.disable).not.toHaveBeenCalled();
  expect(f.listeners.get('DOMContentLoaded')?.size).toBe(1);
});
