import type { CustomerFlag } from './types';

// Serialized into WhatsApp guests: keep paths and colors inside this function.
// SVG contents are fixed application assets, never customer-supplied markup.
export function customerFlagSvg(flag: CustomerFlag): string {
  const icons = {
    priority: {
      color: '#ffd43b',
      path: 'M10 3H22L29 28H31V33H20V28H22L20.8 23H11.2L10 28H12V33H1V28H3L10 3ZM13 17H19L16 7Z',
    },
    follow: {
      color: '#339dff',
      path: 'M3 3H20L27 8V15L23 18L28 22V28L22 33H3V28H6V8H3V3ZM13 9V15H19L21 13V11L19 9H13ZM13 21V27H20L22 25V23L20 21H13Z',
    },
    signup: {
      color: '#2ee86f',
      path: 'M10 3H24L29 8V13H21V10H13L10 13V23L13 26H21V23H29V28L24 33H10L3 26V10L10 3Z',
    },
    deposit: {
      color: '#ff4d5e',
      path: 'M3 3H19L29 12V24L19 33H3V28H6V8H3V3ZM13 10V26H17L22 22V14L17 10H13Z',
    },
  };
  const icon = icons[flag];
  if (!icon) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 38" aria-hidden="true" focusable="false" style="display:block;width:100%;height:100%;color:${icon.color}"><path d="${icon.path}" transform="translate(1 0)" fill="currentColor" fill-rule="evenodd"/></svg>`;
}
