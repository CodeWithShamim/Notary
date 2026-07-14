import { Link } from 'react-router-dom';
import { human, timeLeft } from '../lib/format.js';
import { useConnect } from '../state/ConnectContext.js';
import { FileTextIcon, ClockIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';

const ACTIVE_STATES = new Set(['PROPOSED', 'AWAITING_FUNDS', 'FUNDED', 'DELIVERED_CLAIMED']);

export function MyDeals() {
  const { deals, nametag } = useConnect();
  const list = Object.values(deals).sort((a, b) => b.snapshot.createdAt - a.snapshot.createdAt);

  if (list.length === 0) {
    return (
      <div className="empty">
        <div className="big"><FileTextIcon size={40} /></div>
        <p>No deals yet in this browser.</p>
        <p className="muted">
          Deals appear here live as the notary DMs <code>deal.update</code> snapshots to your wallet.
        </p>
        <Link to="/new" className="btn">Open your first deal</Link>
      </div>
    );
  }

  const active = list.filter(({ snapshot: d }) => ACTIVE_STATES.has(d.state)).length;
  const asBuyer = list.filter(({ snapshot: d }) => d.buyerTag?.toLowerCase() === nametag?.toLowerCase()).length;
  const asSeller = list.filter(({ snapshot: d }) => d.sellerTag?.toLowerCase() === nametag?.toLowerCase()).length;

  const aside = (
    <>
      <AsideCard title="Overview">
        <div className="aside-stats">
          <div className="aside-stat"><span className="k">Total deals</span><span className="v">{list.length}</span></div>
          <div className="aside-stat"><span className="k">Active</span><span className="v gold">{active}</span></div>
          <div className="aside-stat"><span className="k">As buyer</span><span className="v">{asBuyer}</span></div>
          <div className="aside-stat"><span className="k">As seller</span><span className="v">{asSeller}</span></div>
        </div>
      </AsideCard>
      <AsideCard>
        <p className="aside-note">Rows update live as @notary DMs new <code>deal.update</code> snapshots to your wallet.</p>
        <Link to="/new" className="btn block mt-lg">Open a new deal</Link>
      </AsideCard>
    </>
  );

  return (
    <PageLayout aside={aside}>
      <h1>My deals</h1>
      <p className="sub">Live state pushed by @notary over encrypted DMs, merged with its public event API.</p>
      {list.map(({ snapshot: d }) => {
        const role = d.buyerTag?.toLowerCase() === nametag?.toLowerCase() ? 'buyer' : d.sellerTag?.toLowerCase() === nametag?.toLowerCase() ? 'seller' : '?';
        return (
          <Link to={`/deals/${d.dealId}`} key={d.dealId} className="deal-link">
            <div className="deal-row">
              <div>
                <div className="row">
                  <b className="mono">{d.dealId}</b>
                  <span className={`badge ${d.state}`}>{d.state.replace(/_/g, ' ')}</span>
                  <span className="badge">{role}</span>
                </div>
                <div className="muted deal-deliverable">{d.deliverable.slice(0, 90)}</div>
              </div>
              <div className="deal-figures">
                <div className="deal-amt">{human(d.amount)} {d.symbol ?? ''}</div>
                {d.deadlineAt && <div className="muted deadline"><ClockIcon size={14} className="inline-ico" /> {timeLeft(d.deadlineAt)}</div>}
              </div>
            </div>
          </Link>
        );
      })}
    </PageLayout>
  );
}
