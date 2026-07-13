import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchStatus } from '../lib/api.js';
import { human } from '../lib/format.js';

export function Home() {
  const { data: status, isError } = useQuery({ queryKey: ['status'], queryFn: fetchStatus });

  const totalDeals = status ? Object.values(status.dealsByState).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <h1>Escrow, notarized by a machine.</h1>
      <p className="sub">
        <b>@{status?.identity.nametag ?? 'notary'}</b> is an autonomous agent living on the Unicity network. It
        holds funds between two parties who don't trust each other and settles the deal by itself — releases,
        refunds, timeouts and disputes included — for a {status ? status.feeBps / 100 : 1}% fee.
      </p>

      <div className="row" style={{ marginBottom: 24 }}>
        <span className={`badge ${isError ? 'offline' : 'online'}`}>{isError ? '● agent unreachable' : '● agent online'}</span>
        {status && <span className="muted">up {Math.floor(status.uptimeSec / 3600)}h {Math.floor((status.uptimeSec % 3600) / 60)}m · fee {status.feeBps / 100}%</span>}
        <Link to="/new" className="btn" style={{ marginLeft: 'auto' }}>Open a deal →</Link>
      </div>

      <div className="grid3">
        <div className="stat">
          <div className="v">{totalDeals}</div>
          <div className="k">deals notarized</div>
        </div>
        <div className="stat">
          <div className="v">
            {status?.escrowVolume.length
              ? status.escrowVolume.map((v) => `${human(v.total)} ${v.symbol ?? ''}`).join(' · ')
              : '0 UCT'}
          </div>
          <div className="k">escrow volume</div>
        </div>
        <div className="stat">
          <div className="v">{status?.pools.length ?? 0}</div>
          <div className="k">group pools</div>
        </div>
      </div>

      <div className="howit">
        <div className="box">
          <div className="n">1</div>
          <h3>Open &amp; fund</h3>
          <p className="muted">
            Describe the deal and name the seller. When they accept, the notary DMs you a payment request —
            one click moves your funds into escrow. The seller sees the money is real before doing the work.
          </p>
        </div>
        <div className="box">
          <div className="n">2</div>
          <h3>Deliver</h3>
          <p className="muted">
            The seller marks the deal delivered (optionally with proof). You confirm — or dispute. If you stay
            silent past the window, silence counts as acceptance.
          </p>
        </div>
        <div className="box">
          <div className="n">3</div>
          <h3>The agent settles</h3>
          <p className="muted">
            Release, refund, timeout, dispute — every settlement transfer is initiated by the agent itself on
            the network. Nobody holds a "release" button, including us.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Also speaks machine</h2>
        <p className="muted">
          The web app is just one client. Other agents discover @notary on the Unicity intent market and hire it
          directly over encrypted DMs with a documented JSON protocol — plus <code>!pool</code> group-escrow
          commands in NIP-29 chats. See the <Link to="/agent">agent page</Link> for the full protocol reference.
        </p>
      </div>
    </div>
  );
}
