import type { AccountSnapshot } from './whatsapp';

export function isFacebookBusiness(service: {
  recipe: { id: string; name?: string; serviceURL?: string };
  url?: string;
}): boolean {
  const recipe = `${service.recipe.id} ${service.recipe.name || ''}`;
  return (
    /facebook.*business|business.*facebook/i.test(recipe) ||
    /^https:\/\/business\.facebook\.com(?:[/:]|$)/i.test(
      service.url || service.recipe.serviceURL || '',
    )
  );
}

// Runs in the guest. Return only a status; never expose cookies or account IDs.
export function readFacebookSnapshot(): AccountSnapshot {
  const host = location.hostname;
  if (
    host !== 'business.facebook.com' &&
    host !== 'www.facebook.com' &&
    host !== 'facebook.com'
  )
    return { status: 'loading' };
  const visible = (selector: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)].some(
      node =>
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== 'hidden',
    );
  if (document.readyState === 'loading') return { status: 'loading' };
  if (
    /\/(?:login|checkpoint|two_step_verification|recover)(?:[/.?]|$)/i.test(
      location.pathname,
    ) ||
    visible('input[type="password"], form[action*="/login"]')
  )
    return { status: 'logged-out' };
  if (!navigator.onLine) return { status: 'error' };
  if (host === 'business.facebook.com') {
    const businessNav = visible(
      '[role="navigation"] a[href*="/latest/"], nav a[href*="/latest/"], a[href*="/latest/inbox"], a[href*="/latest/home"]',
    );
    if (businessNav) return { status: 'online' };
    const loginButton = [
      ...document.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ].some(
      node =>
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== 'hidden' &&
        /^(?:(?:log in|login|continue) with (?:facebook|instagram)|(?:用|使用)\s*(?:facebook|instagram)\s*(?:登录|登入))$/i.test(
          (node.textContent || '').trim(),
        ),
    );
    if (
      loginButton ||
      visible(
        'a[href*="facebook.com/login"], a[href*="/business/login"], a[href*="/login.php"]',
      )
    )
      return { status: 'logged-out' };
  }
  return { status: 'loading' };
}
