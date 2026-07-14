import '../../styles/loaders.css';

import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

/**
 * A slim neon progress bar pinned to the top of the viewport. It auto-shows
 * while the app is fetching/mutating or navigating, trickles toward ~90%,
 * then jumps to 100% and fades out when activity goes idle.
 */
export function RouteProgressBar(): JSX.Element {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const { pathname } = useLocation();

  const active = isFetching + isMutating > 0;

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  // Keep the latest progress readable inside the trickle interval without
  // re-subscribing the effect on every tick.
  const progressRef = useRef(0);
  progressRef.current = progress;

  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Briefly kick the bar on every route change.
  const [routeTick, setRouteTick] = useState(0);
  useEffect(() => {
    setRouteTick((t) => t + 1);
  }, [pathname]);

  useEffect(() => {
    const clearTrickle = () => {
      if (trickleRef.current !== null) {
        clearInterval(trickleRef.current);
        trickleRef.current = null;
      }
    };

    if (active || routeTick > 0) {
      // Cancel any pending hide/reset from a previous idle cycle.
      if (resetRef.current !== null) clearTimeout(resetRef.current);
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);

      setVisible(true);
      setProgress((p) => (p < 8 ? 8 : p));

      clearTrickle();
      trickleRef.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 90) return p;
          // Diminishing steps as we approach the ceiling.
          const remaining = 90 - p;
          const step = Math.max(0.4, remaining * 0.08);
          return Math.min(90, p + step);
        });
      }, 240);

      // When idle triggered purely by a route change, let it settle.
      if (!active) {
        resetRef.current = setTimeout(() => {
          clearTrickle();
          setProgress(100);
          fadeRef.current = setTimeout(() => {
            setVisible(false);
            setProgress(0);
          }, 400);
        }, 550);
      }
    } else {
      // Fully idle: complete, then fade and reset.
      clearTrickle();
      if (progressRef.current > 0) {
        setProgress(100);
        fadeRef.current = setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 400);
      } else {
        setVisible(false);
      }
    }

    return () => {
      clearTrickle();
    };
  }, [active, routeTick]);

  // Global unmount cleanup for the deferred timers.
  useEffect(() => {
    return () => {
      if (resetRef.current !== null) clearTimeout(resetRef.current);
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
      if (trickleRef.current !== null) clearInterval(trickleRef.current);
    };
  }, []);

  return (
    <div className="ldr-progress" data-hidden={!visible} aria-hidden="true">
      <div
        className="ldr-progress-bar"
        style={{ transform: `translate3d(${progress - 100}%, 0, 0)` }}
      >
        <span className="ldr-progress-comet" />
      </div>
    </div>
  );
}

/** A neon glowing dual-tone conic spinner with an optional mono label below. */
export function NeonSpinner({
  size = 28,
  label,
}: {
  size?: number;
  label?: string;
}): JSX.Element {
  return (
    <span className="ldr-spinner-wrap" role="status" aria-live="polite">
      <span
        className="ldr-spinner"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      {label ? <span className="ldr-spinner-label">{label}</span> : null}
      {label ? null : <span className="ldr-sr-only" style={srOnly}>Loading</span>}
    </span>
  );
}

/** A dark shimmer skeleton block with a diagonal neon sweep. */
export function Skeleton({
  width,
  height,
  radius,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}): JSX.Element {
  const toCss = (v: number | string | undefined): string | undefined =>
    v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;

  return (
    <span
      className={className ? `ldr-skeleton ${className}` : 'ldr-skeleton'}
      aria-hidden="true"
      style={{
        width: toCss(width),
        height: toCss(height) ?? '1em',
        borderRadius: toCss(radius) ?? '8px',
      }}
    />
  );
}

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
