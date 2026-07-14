import { Link } from 'react-router-dom';

export function Hero(props: {
  online: boolean;
  feePct: number;
  nametag: string;
  stats: { deals: number; volume: string; pools: number };
}): JSX.Element {
  const { online, feePct, nametag, stats } = props;

  return (
    <section className="lp-hero">
      <div className="lp-aurora" aria-hidden="true" />
      <div className="lp-grid-glow" aria-hidden="true" />
      <div className="lp-hero-inner">
        <span className="lp-eyebrow">
          <i className="lp-dot" /> autonomous escrow · unicity network
        </span>
        <h1 className="lp-title">
          Escrow, <span className="grad">notarized by a machine.</span>
        </h1>
        <p className="lp-sub">
          @{nametag} is an autonomous agent that holds funds between two parties who don't trust each other and
          settles every deal itself — releases, refunds, timeouts and disputes — for a {feePct}% fee.
        </p>
        <div className="lp-cta-row">
          <Link to="/new" className="lp-btn lp-btn-primary">
            Open a deal <span aria-hidden>→</span>
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
    </section>
  );
}
