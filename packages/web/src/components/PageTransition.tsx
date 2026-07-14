import '../styles/transitions.css';

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Wraps the app's <Routes> and plays a "web3 modern" transition on every
 * route change: the content area rises/fades/blurs in while a neon light
 * band sweeps across the viewport. Content always stays mounted; the sweep
 * is a pointer-events:none overlay that self-removes after it finishes.
 */
export function PageTransition({ children }: { children: React.ReactNode }): JSX.Element {
  const location = useLocation();
  const [sweeping, setSweeping] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    // Skip the sweep on initial mount; only animate on subsequent changes.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    setSweeping(true);
    const timer = window.setTimeout(() => setSweeping(false), 650);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  return (
    <>
      {/* Re-keying by pathname remounts the wrapper so the enter animation replays. */}
      <div key={location.pathname} className="ptx-content">
        {children}
      </div>
      {sweeping && <div className="ptx-sweep" aria-hidden="true" />}
    </>
  );
}
