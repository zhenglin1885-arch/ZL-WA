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

// Runs in the guest. Return only a status, never cookies or account identifiers.
export function readFacebookSnapshot(): AccountSnapshot {
  const host = location.hostname;
  if (
    !['business.facebook.com', 'www.facebook.com', 'facebook.com'].includes(
      host,
    )
  )
    return { status: 'loading' };
  const isVisible = (node: Element) =>
    node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== 'hidden';
  const visible = (selector: string) =>
    [...document.querySelectorAll(selector)].some(isVisible);
  const textOf = (node: Element) =>
    (node.textContent || node.getAttribute('aria-label') || '')
      .replaceAll(/\s+/g, ' ')
      .trim();
  if (document.readyState === 'loading') return { status: 'loading' };
  if (
    /\/(?:login|checkpoint|two_step_verification|recover)(?:[./?]|$)/i.test(
      location.pathname,
    ) ||
    visible('input[type="password"], form[action*="/login"]')
  )
    return { status: 'logged-out' };
  if (!navigator.onLine) return { status: 'error' };
  if (host === 'business.facebook.com') {
    const links =
      '[role="navigation"] a[href*="/latest/"], nav a[href*="/latest/"], a[href*="/latest/inbox"], a[href*="/latest/home"]';
    const controls = [
      ...document.querySelectorAll('a, button, [role="link"], [role="button"]'),
    ].filter(isVisible);
    const labels = new Set(
      controls.map(textOf).map(text => text.toLowerCase()),
    );
    const menuLabels = [
      ['home', '首页', '主页', 'página inicial', 'inicio'],
      ['inbox', '收件箱', 'caixa de entrada', 'bandeja de entrada'],
      ['content', '内容', 'conteúdo', 'contenido'],
      ['planner', '规划工具', '日程安排', 'planejador', 'planificador'],
      ['insights', '成效分析', '洞察', 'estatísticas', 'estadísticas'],
      [
        'all tools',
        '所有工具',
        '全部工具',
        'todas as ferramentas',
        'todas las herramientas',
      ],
    ];
    const menus = menuLabels.filter(aliases =>
      aliases.some(label => labels.has(label)),
    ).length;
    const workspace =
      visible(links) ||
      (menus >= 3 &&
        (/^\/latest(?:\/|$)/.test(location.pathname) ||
          visible('[role="navigation"], nav')));
    if (workspace) return { status: 'online' };
    const loginButton = controls.some(node =>
      /^(?:(?:log in|login|continue) with (?:facebook|instagram)|(?:用|使用)\s*(?:facebook|instagram)\s*(?:登录|登入|继续)|(?:continuar|iniciar sesi[oó]n) (?:com|con) (?:o |el )?(?:facebook|instagram))$/i.test(
        textOf(node),
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
  // Meta's own session data supports layouts with icon-only/non-link menus.
  // A visible login screen takes precedence over an earlier bootstrapped session.
  const page = window as unknown as { require?: (name: string) => unknown };
  try {
    const data = page.require?.('CurrentUserInitialData') as
      | { USER_ID?: unknown }
      | undefined;
    if (data && typeof data.USER_ID === 'string' && /^\d+$/.test(data.USER_ID))
      return { status: /^0+$/.test(data.USER_ID) ? 'logged-out' : 'online' };
  } catch {
    // Module names can change; keep the DOM-based result when unavailable.
  }
  return { status: 'loading' };
}
