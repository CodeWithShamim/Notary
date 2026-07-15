import { Reveal } from './Reveal.js';

/**
 * Architecture diagram: an animated SVG that shows how custody actually flows.
 *
 * Buyer deposits into the autonomous Notary agent, the agent holds the funds in
 * escrow, and the agent itself settles the deal on the Unicity ledger — the
 * money is either released to the seller or refunded to the buyer. Every stroke
 * is inline so it inherits the landing palette, and all motion is CSS-driven so
 * `prefers-reduced-motion` can switch it off cleanly.
 *
 * The connection geometry is declared once here and reused for both the visible
 * line and the flowing particle's `offset-path`, so the dots always ride the
 * wire exactly.
 */
const WIRE = {
  deposit: 'M 232 250 C 340 250, 392 192, 486 186',
  release: 'M 634 186 C 728 192, 780 250, 888 250',
  settle: 'M 560 258 L 560 430',
} as const;

function Particle({ path, delay, className }: { path: string; delay: number; className: string }) {
  return (
    <circle
      r="4.5"
      className={className}
      style={{ offsetPath: `path('${path}')`, animationDelay: `${delay}s` } as React.CSSProperties}
    />
  );
}

export function Architecture() {
  return (
    <section className="lp-section">
      <Reveal from="up">
        <div className="lp-head">
          <span className="lp-kicker">architecture</span>
          <h2 className="lp-h2">Where the money <em>actually</em> sits.</h2>
          <p className="lp-lede">
            Funds never touch a person. They move from the buyer into the agent&apos;s custody, and
            the agent settles the deal itself on the Unicity ledger — releasing to the seller or
            refunding the buyer.
          </p>
        </div>
      </Reveal>

      <Reveal from="up" delay={80}>
        <div className="lp-arch">
          <svg
            className="arch-svg"
            viewBox="0 0 1120 600"
            role="img"
            aria-label="Buyer deposits funds into the autonomous Notary agent, which holds them in escrow and settles the deal on the Unicity ledger, releasing to the seller or refunding the buyer."
          >
            <defs>
              <linearGradient id="arch-wire" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#34d399" />
                <stop offset="0.5" stopColor="#2dd4bf" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
              <radialGradient id="arch-hub" cx="0.5" cy="0.4" r="0.75">
                <stop offset="0" stopColor="#7be3b1" />
                <stop offset="0.55" stopColor="#2dd4bf" />
                <stop offset="1" stopColor="#0e4634" />
              </radialGradient>
              <linearGradient id="arch-ledger" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#34d399" />
              </linearGradient>
              <filter id="arch-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* ── Connections (drawn behind the nodes) ───────────────────── */}
            <g fill="none" strokeLinecap="round">
              {Object.values(WIRE).map((d) => (
                <path key={d} d={d} className="arch-wire-base" />
              ))}
              {Object.values(WIRE).map((d) => (
                <path key={`f-${d}`} d={d} className="arch-wire-flow" stroke="url(#arch-wire)" />
              ))}
            </g>
            <Particle path={WIRE.deposit} delay={0} className="arch-particle p-in" />
            <Particle path={WIRE.deposit} delay={1.4} className="arch-particle p-in" />
            <Particle path={WIRE.release} delay={0.7} className="arch-particle p-out" />
            <Particle path={WIRE.settle} delay={0.3} className="arch-particle p-settle" />
            <Particle path={WIRE.settle} delay={1.6} className="arch-particle p-settle" />

            {/* wire labels */}
            <text x="352" y="205" className="arch-wire-label">deposit</text>
            <text x="768" y="205" className="arch-wire-label" textAnchor="end">release / refund</text>
            <text x="574" y="352" className="arch-wire-label arch-wire-label-v">settles on-chain</text>

            {/* ── Unicity ledger band ────────────────────────────────────── */}
            <g className="arch-ledger">
              <rect x="180" y="430" width="760" height="112" rx="18" className="arch-ledger-bg" />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <g key={i} className="arch-block" style={{ animationDelay: `${i * 0.55}s` }}>
                  <rect x={220 + i * 118} y="462" width="88" height="48" rx="9" />
                  <line x1={220 + i * 118 + 88} y1="486" x2={220 + (i + 1) * 118} y2="486" />
                </g>
              ))}
              <text x="200" y="418" className="arch-ledger-label">unicity ledger · settlement layer</text>
            </g>

            {/* ── Buyer node ─────────────────────────────────────────────── */}
            <g className="arch-node" transform="translate(150 250)">
              <rect x="-82" y="-52" width="164" height="104" rx="18" className="arch-node-bg" />
              <g transform="translate(0 -14)" className="arch-node-icon" fill="none" strokeWidth="3.2">
                <rect x="-20" y="-13" width="40" height="26" rx="5" />
                <path d="M-20 -6 h40" />
                <circle cx="12" cy="4" r="2.6" fill="currentColor" stroke="none" />
              </g>
              <text y="22" className="arch-node-title">Buyer</text>
              <text y="40" className="arch-node-sub">funds the deal</text>
            </g>

            {/* ── Seller node ────────────────────────────────────────────── */}
            <g className="arch-node" transform="translate(970 250)">
              <rect x="-82" y="-52" width="164" height="104" rx="18" className="arch-node-bg" />
              <g transform="translate(0 -14)" className="arch-node-icon" fill="none" strokeWidth="3.2">
                <path d="M-18 -8 L0 -16 L18 -8 L18 10 L0 18 L-18 10 Z" />
                <path d="M-18 -8 L0 0 L18 -8 M0 0 V18" />
              </g>
              <text y="22" className="arch-node-title">Seller</text>
              <text y="40" className="arch-node-sub">delivers &amp; gets paid</text>
            </g>

            {/* ── Notary agent hub ───────────────────────────────────────── */}
            <g transform="translate(560 186)">
              <circle r="98" className="arch-hub-ring r1" />
              <circle r="98" className="arch-hub-ring r2" />
              <circle r="72" className="arch-hub-halo" />
              <circle r="60" fill="url(#arch-hub)" className="arch-hub-core" filter="url(#arch-glow)" />
              <circle r="60" className="arch-hub-stroke" fill="none" />
              <g
                transform="translate(-22.8 -30.8) scale(1.9)"
                fill="none"
                stroke="#fff"
                strokeWidth={1.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v18M7 21h10" />
                <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
                <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
              </g>
              <text y="26" className="arch-hub-label">Notary agent</text>
            </g>
            <text x="560" y="316" className="arch-hub-caption">autonomous · holds escrow · settles itself</text>
          </svg>

          <ul className="arch-legend" aria-hidden="true">
            <li><i className="dot d-in" /> Buyer deposits into custody</li>
            <li><i className="dot d-hub" /> Agent holds the escrow</li>
            <li><i className="dot d-out" /> Agent settles on-chain</li>
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
