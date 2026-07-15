/**
 * Per-page document metadata for the SPA.
 *
 * `index.html` ships the *static* metadata that is identical on every route —
 * site name, category, the social banner (og:image), Twitter card type. This
 * hook layers the *per-page* pieces on top: the document title, description,
 * canonical URL and the title/description mirrors that Open Graph and Twitter
 * read. Search crawlers and link-unfurlers that execute JS (and the browser
 * tab) then see the right title/description for whichever page is open.
 *
 * Tags are created on demand and updated in place, so a route change just
 * rewrites the same nodes rather than accumulating duplicates.
 */
import { useEffect } from 'react';

const SITE_NAME = 'Notary';
/** Appended to every page title except the home page, which stands alone. */
const TITLE_SUFFIX = ` · ${SITE_NAME}`;

export interface PageMeta {
  /** Page title. The home page passes its full title; other pages pass a short
   *  label (e.g. "Marketplace") and get " · Notary" appended automatically. */
  title: string;
  description: string;
  /** Set true on the landing page so its title is used verbatim (no suffix). */
  root?: boolean;
}

/** Find-or-create a `<meta>` keyed by `name=` or `property=`, then set content. */
function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Find-or-create `<link rel="canonical">` and point it at the current URL. */
function setCanonical(url: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}

/**
 * Apply this page's metadata. Re-runs whenever `title`/`description` change so
 * pages with dynamic titles (e.g. a specific deal) stay in sync.
 */
export function useMeta({ title, description, root }: PageMeta): void {
  useEffect(() => {
    const fullTitle = root ? title : `${title}${TITLE_SUFFIX}`;
    const url = window.location.href;

    document.title = fullTitle;
    setMeta('name', 'description', description);
    setCanonical(url);

    // Open Graph mirrors (og:image / og:site_name / og:type live in index.html).
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);

    // Twitter mirrors (twitter:card / twitter:image live in index.html).
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', description);

    // Upgrade the banner/logo to absolute URLs. index.html can only ship relative
    // paths (the origin is unknown at build time); link-unfurlers want absolute.
    const abs = (path: string) => new URL(path, window.location.origin).href;
    setMeta('property', 'og:image', abs('/og-banner.png'));
    setMeta('property', 'og:logo', abs('/favicon.svg'));
    setMeta('name', 'twitter:image', abs('/og-banner.png'));
  }, [title, description, root]);
}
