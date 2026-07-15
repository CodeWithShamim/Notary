import { useEffect, useRef } from 'react';
import type HlsType from 'hls.js';

const STREAM = 'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';

/**
 * Full-bleed HLS background video for the landing hero.
 * Prefers native HLS (Safari); falls back to hls.js with the worker
 * disabled so it stays stable in sandboxed/iframe environments.
 */
export function HeroVideo(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Safari & iOS play m3u8 natively — no library needed.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = STREAM;
      void video.play().catch(() => {});
      return;
    }

    // Lazy-load hls.js (~500 kB) so it stays out of the main bundle.
    let hls: HlsType | undefined;
    let cancelled = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      hls = new Hls({ enableWorker: false });
      hls.loadSource(STREAM);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {});
      });
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, []);

  return (
    <div className="lpv-media" aria-hidden="true">
      <video ref={videoRef} className="lpv-video" muted loop playsInline autoPlay preload="metadata" />
      {/* readability washes: left→transparent + bottom→up */}
      <div className="lpv-shade lpv-shade-left" />
      <div className="lpv-shade lpv-shade-bottom" />
      {/* thin vertical grid lines at 25 / 50 / 75% (desktop) */}
      <div className="lpv-gridlines" />
      {/* central cyan / dark-green ellipse glow */}
      <svg className="lpv-glow" viewBox="0 0 1200 500" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="lpv-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="25" />
          </filter>
        </defs>
        <ellipse cx="600" cy="150" rx="420" ry="110" fill="#1c4a3c" opacity="0.55" filter="url(#lpv-blur)" />
        <ellipse cx="600" cy="150" rx="260" ry="70" fill="#2ba98a" opacity="0.3" filter="url(#lpv-blur)" />
      </svg>
    </div>
  );
}
