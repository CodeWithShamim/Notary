/**
 * Theme (dark / light) management.
 *
 * The active theme is reflected as `data-theme` on `<html>` and persisted to
 * localStorage. An inline script in index.html applies the stored/system theme
 * before first paint (no flash), so this module only has to keep it in sync
 * afterwards and animate transitions.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'notary-theme';

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

/** Whether the user has explicitly chosen a theme (vs. following the system). */
function hasStoredTheme(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

function persist(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / storage disabled — theme still applies for this session */
  }
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Switch to `theme`, animating the change. When the View Transitions API is
 * available (and motion isn't reduced) the new theme is revealed with an
 * expanding circular clip originating from the click point; otherwise it flips
 * with a brief cross-property colour transition.
 */
export function setTheme(theme: Theme, origin?: { x: number; y: number }): void {
  persist(theme);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startViewTransition = (
    document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    }
  ).startViewTransition;

  if (reduceMotion || typeof startViewTransition !== 'function') {
    flipWithColorTransition(theme, reduceMotion);
    return;
  }

  const { x, y } = origin ?? { x: innerWidth - 56, y: 56 };
  const transition = startViewTransition.call(document, () => apply(theme));
  transition.ready.then(() => {
    const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
      },
      {
        duration: 480,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  });
}

/** Fallback path: enable a short colour transition on everything, then flip. */
function flipWithColorTransition(theme: Theme, reduceMotion: boolean): void {
  if (reduceMotion) {
    apply(theme);
    return;
  }
  const root = document.documentElement;
  root.classList.add('theme-anim');
  apply(theme);
  window.setTimeout(() => root.classList.remove('theme-anim'), 420);
}

export function toggleTheme(origin?: { x: number; y: number }): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next, origin);
  return next;
}

/**
 * Keep following the OS theme until the user makes an explicit choice. Returns
 * an unsubscribe function.
 */
export function watchSystemTheme(): () => void {
  const mql = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = (e: MediaQueryListEvent) => {
    if (!hasStoredTheme()) apply(e.matches ? 'light' : 'dark');
  };
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
