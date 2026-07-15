import { Link } from 'react-router-dom';
import { HeroVideo } from '../../components/HeroVideo.js';

export function Hero(props: {
  online: boolean;
  feePct: number;
  nametag: string;
  stats: { deals: number; volume: string; pools: number };
}): JSX.Element {
  const { online, feePct, nametag, stats } = props;

  return (
    <section className="lp-hero lpv">
      <HeroVideo />
      <div className="lp-hero-grid">
        {/* ── Left: content ─────────────────────────────────────────── */}
        <div className="lp-hero-content">
          {/* liquid glass card */}
          <div className="lpv-card">
            <span className="lpv-card-tag">[ TESTNET2 ]</span>
            <span className="lpv-card-head">
              Settled by an <em>autonomous</em> agent
            </span>
            <span className="lpv-card-desc">
              Releases, refunds, timeouts and disputes — resolved without human intervention.
            </span>
          </div>
          <span className="lpv-eyebrow">
            <i className="lp-dot" /> autonomous escrow · unicity network
          </span>
          <h1 className="lpv-title">
            Escrow, notarized by a machine<span className="lpv-period">.</span>
          </h1>
          <p className="lpv-sub">
            @{nametag} is an autonomous agent that holds funds between two parties who don't trust
            each other and settles every deal itself - releases, refunds, timeouts and disputes -
            for a {feePct}% fee.
          </p>
          <div className="lp-cta-row">
            <Link to="/new" className="lpv-btn-primary">
              Open a deal
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <path
                  d="M5 12h14m-6-6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <Link to="/agent" className="lp-btn lp-btn-ghost">
              Read the protocol
            </Link>
          </div>
          <div className="lp-status">
            <span className={`lp-badge ${online ? 'online' : 'offline'}`}>
              <i />
              {online ? 'agent online' : 'agent offline'}
            </span>
            <span className="lp-status-meta">
              {feePct}% fee · settles autonomously · @{nametag}
            </span>
          </div>
          <div className="lp-stats">
            <div className="lp-stat">
              <div className="lp-stat-v">{stats.deals}</div>
              <div className="lp-stat-k">deals notarized</div>
            </div>
            <div className="lp-stat">
              <div className="lp-stat-v">{stats.volume}</div>
              <div className="lp-stat-k">escrow volume</div>
            </div>
            <div className="lp-stat">
              <div className="lp-stat-v">{stats.pools}</div>
              <div className="lp-stat-k">group pools</div>
            </div>
          </div>
        </div>

        {/* ── Right: live escrow console ───────────────────────────── */}
        <div className="lp-hero-visual" aria-hidden="true">
          <div className="lp-console">
            <div className="lp-console-glow" />

            {/* window chrome + live status */}
            <header className="lp-con-bar">
              <span className="lp-con-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="lp-con-id">deal · 0xA3F0…9C2</span>
              <span className={`lp-con-live ${online ? 'on' : ''}`}>
                <i /> {online ? 'live' : 'idle'}
              </span>
            </header>

            <div className="lp-con-body">
              {/* escrow flow: buyer → vault → seller */}
              <div className="lp-flow">
                <div className="lp-node">
                  <span className="lp-node-ic">B</span>
                  <span className="lp-node-k">Buyer</span>
                  <span className="lp-node-v">funded</span>
                </div>
                <div className="lp-wire">
                  <span className="lp-packet" />
                </div>
                <div className="lp-node lp-node-vault">
                  <span className="lp-node-ic">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                      <path
                        d="M12 2 4 5v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V5l-8-3Z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path
                        d="m9 12 2.2 2.2L15.5 10"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="lp-node-k">Vault</span>
                  <span className="lp-node-v">holding</span>
                </div>
                <div className="lp-wire">
                  <span className="lp-packet lp-packet-2" />
                </div>
                <div className="lp-node">
                  <span className="lp-node-ic">S</span>
                  <span className="lp-node-k">Seller</span>
                  <span className="lp-node-v">pending</span>
                </div>
              </div>

              {/* locked amount + progress meter */}
              <div className="lp-amount">
                <div className="lp-amount-head">
                  <span className="lp-amount-k">Escrow locked</span>
                  <span className="lp-amount-v">
                    2,400 <em>UCT</em>
                  </span>
                </div>
                <div className="lp-meter">
                  <span className="lp-meter-fill" />
                </div>
                <div className="lp-amount-foot">
                  <span>condition 2 / 3 met</span>
                  <span>fee {feePct}%</span>
                </div>
              </div>

              {/* settlement timeline */}
              <ul className="lp-steps-mini">
                <li className="done">
                  <i /> Terms signed by both parties
                </li>
                <li className="done">
                  <i /> Funds locked in vault
                </li>
                <li className="active">
                  <i /> Delivery confirmation
                  <span className="lp-step-tag">awaiting</span>
                </li>
                <li>
                  <i /> Auto-release to seller
                </li>
              </ul>
            </div>

            {/* telemetry footer */}
            <footer className="lp-con-foot">
              <span className="lp-tele">
                <b>18ms</b> settle latency
              </span>
              <span className="lp-tele">
                <b>{stats.deals}</b> notarized
              </span>
              <span className="lp-tele">
                <b>unicity</b> network
              </span>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}
