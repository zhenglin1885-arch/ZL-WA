import { DEFAULT_ACCENT_COLOR } from '../src/config';
import {
  appThemeSource,
  appAccentColor,
  lightThemeText,
} from '../src/features/appearance/theme';

describe('application Chromium theme source', () => {
  it.each([
    [false, true, 'system'],
    [false, false, 'light'],
    [true, false, 'dark'],
    [true, true, 'dark'],
  ] as const)(
    'uses dark=%s, follow system=%s as %s',
    (darkMode, adaptableDarkMode, source) => {
      expect(appThemeSource({ darkMode, adaptableDarkMode })).toBe(source);
    },
  );
});

describe('independent light mode accent', () => {
  it('uses the separate light preference without changing an existing dark accent', () => {
    const settings = { accentColor: '#8455c9', lightThemeColor: '#15a3bf' };
    expect(appAccentColor(settings, false)).toBe('#15a3bf');
    expect(appAccentColor(settings, true)).toBe('#8455c9');
    expect(
      appAccentColor({ ...settings, lightThemeColor: '#ffffcc' }, true),
    ).toBe('#8455c9');
  });
  it('keeps legacy dark settings and defaults safe for missing or invalid light colors', () => {
    expect(appAccentColor({ accentColor: '#123456' }, false)).toBe(
      DEFAULT_ACCENT_COLOR,
    );
    expect(appAccentColor({ lightThemeColor: 'invalid css' }, false)).toBe(
      DEFAULT_ACCENT_COLOR,
    );
    expect(appAccentColor({ accentColor: '#123456' }, true)).toBe('#123456');
    expect(lightThemeText('#ffffcc')).toBe('#17212b');
    expect(lightThemeText('#123456')).toBe('#ffffff');
  });
});
