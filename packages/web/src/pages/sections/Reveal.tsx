import { useEffect, useRef, useState, type ReactNode } from 'react';

type Direction = 'left' | 'right' | 'up';

/**
 * Scroll-triggered reveal. Renders a wrapper that starts offset + transparent
 * (from the left, right, or below) and slides into place the first time it
 * enters the viewport. Honors `prefers-reduced-motion` - those users get the
 * final state immediately with no motion.
 */
export function Reveal({
  children,
  from = 'up',
  delay = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode;
  from?: Direction;
  /** Stagger, in ms. */
  delay?: number;
  as?: 'div' | 'section' | 'article' | 'li';
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion (or no IntersectionObserver): reveal immediately.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal reveal-${from}${shown ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
