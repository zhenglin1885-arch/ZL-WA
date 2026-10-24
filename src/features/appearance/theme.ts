import tinycolor from 'tinycolor2';
import { DEFAULT_ACCENT_COLOR } from '../../config';

// Keep application, Chromium media queries and MUI on one effective theme.
export function appThemeSource(settings: {
  darkMode: boolean;
  adaptableDarkMode: boolean;
}): 'dark' | 'light' | 'system' {
  // Preserve explicit dark preferences saved by earlier versions.
  return settings.darkMode
    ? 'dark'
    : settings.adaptableDarkMode
      ? 'system'
      : 'light';
}

// Light colors are independent of the existing dark accent preference.
export function appAccentColor(
  settings: { accentColor?: string; lightThemeColor?: string },
  dark: boolean,
): string {
  const selected = dark ? settings.accentColor : settings.lightThemeColor;
  return selected && tinycolor(selected).isValid()
    ? dark
      ? selected
      : tinycolor(selected).toHexString()
    : DEFAULT_ACCENT_COLOR;
}

export function lightThemeText(color: string): string {
  return tinycolor.mostReadable(color, ['#17212b', '#ffffff'])!.toHexString();
}
