import '../styles/transitions.css';

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Each route gets its own "web3 modern" enter animation so navigating between
 * sections feels distinct. The variant drives both the content reveal and the
 * neon overlay via a `data-ptx` attribute (see transitions.css):
 *
 *   scan   /            Home        — light bar scans top→bottom
 *   slide  /new         New Deal    — content slides in from the right
 *   rise   /deals       My Deals    — content lifts up, light bar scans up
 *   zoom   /deals/:id   Deal Detail — content pulls into focus from center
 *   tilt   /pools       Pools       — content settles from a 3D perspective tilt
 *   glitch /agent       Agent       — quick chromatic glitch-in
 */
function variantFor(pathname: string): string {
  const parts = pathname.split('/');
  const seg = parts[1] ?? '';
  switch (seg) {
    case '':
      return 'scan';
    case 'new':
      return 'slide';
    case 'deals':
      // /deals -> list, /deals/:id -> detail
      return parts.length > 2 && parts[2] ? 'zoom' : 'rise';
    case 'pools':
      return 'tilt';
    case 'agent':
      return 'glitch';
    default:
      return 'scan';
  }
}

/**
 * Wraps the app's <Routes>. Content always stays mounted; the neon overlay is a
 * pointer-events:none layer that self-removes once the transition finishes.
 */
export function PageTransition({ children }: { children: React.ReactNode }): JSX.Element {
  const location = useLocation();
  const [sweeping, setSweeping] = useState(false);
  const firstRender = useRef(true);
  const variant = variantFor(location.pathname);

  useEffect(() => {
    // Skip the sweep on initial mount; only animate on subsequent changes.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    setSweeping(true);
    const timer = window.setTimeout(() => setSweeping(false), 720);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  return (
    <>
      {/* Re-keying by pathname remounts the wrapper so the enter animation replays. */}
      <div key={location.pathname} className="ptx-content" data-ptx={variant}>
        {children}
      </div>
      {sweeping && <div className="ptx-sweep" data-ptx={variant} aria-hidden="true" />}
    </>
  );
}
