import { useEffect, useState } from 'react';
import { getTheme, toggleTheme, watchSystemTheme, type Theme } from '../lib/theme.js';

/**
 * Sun/moon theme switch for the navbar. Toggling flips `data-theme` on <html>
 * via a View-Transitions circular reveal that radiates from the button.
 */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  // Follow the OS theme until the user makes an explicit choice, and stay in
  // sync if it changes elsewhere.
  useEffect(() => {
    setThemeState(getTheme());
    return watchSystemTheme();
  }, []);

  const isDark = theme === 'dark';

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setThemeState(toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onClick}
      role="switch"
      aria-checked={!isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
    >
      <svg className="theme-toggle-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {/* sun rays — fade/scale out in dark mode */}
        <g className="tt-sun">
          <circle cx="12" cy="12" r="4.2" />
          <g strokeWidth="1.8" strokeLinecap="round">
            <line x1="12" y1="2.4" x2="12" y2="4.6" />
            <line x1="12" y1="19.4" x2="12" y2="21.6" />
            <line x1="2.4" y1="12" x2="4.6" y2="12" />
            <line x1="19.4" y1="12" x2="21.6" y2="12" />
            <line x1="5.2" y1="5.2" x2="6.8" y2="6.8" />
            <line x1="17.2" y1="17.2" x2="18.8" y2="18.8" />
            <line x1="5.2" y1="18.8" x2="6.8" y2="17.2" />
            <line x1="17.2" y1="6.8" x2="18.8" y2="5.2" />
          </g>
        </g>
        {/* crescent moon — revealed in dark mode */}
        <path className="tt-moon" d="M20 13.6A7.6 7.6 0 0 1 10.4 4 6.4 6.4 0 1 0 20 13.6Z" />
      </svg>
    </button>
  );
}
