import type { ReactNode } from 'react';

/**
 * Two-column app-page shell: primary content on the left, a contextual
 * sidebar on the right. The aside sticks on desktop and drops below the
 * main content on narrow screens (see `.page-2col` in styles.css).
 *
 * Pass no `aside` and it renders children as-is, so full-bleed states
 * (empty views, wizards) can opt out without a wrapper.
 */
export function PageLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  if (!aside) return <>{children}</>;
  return (
    <div className="page-2col">
      <div className="page-main">{children}</div>
      <aside className="page-aside">{aside}</aside>
    </div>
  );
}

/** A quiet sidebar card with an optional uppercase eyebrow title. */
export function AsideCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="aside-card">
      {title && <div className="aside-title">{title}</div>}
      {children}
    </div>
  );
}
