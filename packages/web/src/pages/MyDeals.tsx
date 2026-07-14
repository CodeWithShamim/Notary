import { Link } from 'react-router-dom';
import { human, timeLeft } from '../lib/format.js';
import { useConnect } from '../state/ConnectContext.js';

export function MyDeals() {
  const { deals, nametag } = useConnect();
  const list = Object.values(deals).sort((a, b) => b.snapshot.createdAt - a.snapshot.createdAt);

  if (list.length === 0) {
    return (
      <div className="empty">
        <div className="big">📜</div>
        <p>No deals yet in this browser.</p>
        <p className="muted">
          Deals appear here live as the notary DMs <code>deal.update</code> snapshots to your wallet.
        </p>
        <Link to="/new" className="btn">Open your first deal</Link>
      </div>
    );
  }

  return (
    <div>
      <h1>My deals</h1>
      <p className="sub">Live state pushed by @notary over encrypted DMs, merged with its public event API.</p>
      {list.map(({ snapshot: d }) => {
        const role = d.buyerTag?.toLowerCase() === nametag?.toLowerCase() ? 'buyer' : d.sellerTag?.toLowerCase() === nametag?.toLowerCase() ? 'seller' : '?';
        return (
          <Link to={`/deals/${d.dealId}`} key={d.dealId} style={{ color: 'inherit' }}>
            <div className="deal-row">
              <div>
                <div className="row">
                  <b className="mono">{d.dealId}</b>
                  <span className={`badge ${d.state}`}>{d.state.replace(/_/g, ' ')}</span>
                  <span className="badge">{role}</span>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>{d.deliverable.slice(0, 90)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'var(--gold)', fontWeight: 600 }}>{human(d.amount)} {d.symbol ?? ''}</div>
                {d.deadlineAt && <div className="muted">⏱ {timeLeft(d.deadlineAt)}</div>}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
