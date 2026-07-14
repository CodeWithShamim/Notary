import '../styles/bootloader.css';
import { useEffect, useRef, useState } from 'react';
import { ScaleIcon } from './Icon.js';

const BOOT_LINES = [
  'Initializing keypair…',
  'Connecting to Unicity testnet2…',
  'Verifying escrow contracts…',
  'Ready.',
];

const FULL_DURATION = 2400;
const REDUCED_DURATION = 600;
const FADE_MS = 450;

/**
 * Full-screen web3 boot sequence shown on first load. Drives a 0→100 progress
 * meter, cycles status lines, then fades out and calls `onDone()` once.
 */
export function BootLoader({ onDone }: { onDone: () => void }): JSX.Element {
  const [progress, setProgress] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? REDUCED_DURATION : FULL_DURATION;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    const start = performance.now();

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    };

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out so the meter surges early then settles.
      const eased = 1 - Math.pow(1 - t, 2);
      setProgress(Math.round(eased * 100));
      setLineIndex(Math.min(BOOT_LINES.length - 1, Math.floor(t * BOOT_LINES.length)));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setProgress(100);
        setLineIndex(BOOT_LINES.length - 1);
        setLeaving(true);
        timers.push(setTimeout(finish, FADE_MS));
      }
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [onDone]);

  return (
    <div className={`boot-overlay${leaving ? ' boot-leaving' : ''}`} role="status" aria-live="polite">
      <div className="boot-grid" />
      <div className="boot-blob boot-blob-1" />
      <div className="boot-blob boot-blob-2" />
      <div className="boot-blob boot-blob-3" />
      <div className="boot-scan" />

      <div className="boot-emblem">
        <span className="boot-ring" />
        <span className="boot-ring boot-ring-2" />
        <span className="boot-seal" aria-hidden="true"><ScaleIcon size={64} /></span>
      </div>

      <div className="boot-word" data-text="NOTARY">NOTARY</div>

      <div className="boot-panel">
        <div className="boot-status">
          <span className="boot-dot" />
          <span className="boot-status-line" key={lineIndex}>{BOOT_LINES[lineIndex]}</span>
        </div>
        <div className="boot-bar">
          <div className="boot-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="boot-meta">
          <span>SECURE BOOT</span>
          <span className="boot-pct">{progress}%</span>
        </div>
      </div>
    </div>
  );
}
