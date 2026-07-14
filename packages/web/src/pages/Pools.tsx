import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../lib/api.js';
import { human, timeLeft } from '../lib/format.js';
import { InboxIcon } from '../components/Icon.js';

export function Pools() {
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: fetchStatus });
  const pools = status?.pools ?? [];

  return (
    <div>
      <h1>Group pools</h1>
      <p className="sub">
        Escrow for groups: everyone chips in the same amount inside a NIP-29 group chat; the creator pays the
        pot out (minus the notary fee) or cancels for a full refund. Partial pools auto-refund at the deadline.
      </p>

      <div className="card">
        <h2>How to run one (v1 is chat-native)</h2>
        <pre className="json">{`# in a NIP-29 group that @notary watches (DM "!pool watch <groupId>" to invite it)
!pool create 20000 UCT Team pizza fund     # start a pool: 20000 base units each
!pool join pool_ab12cd                     # you get a payment request in your wallet
!pool status pool_ab12cd                   # progress
!pool payout pool_ab12cd @carol            # creator only - pays pot minus 1% fee
!pool cancel pool_ab12cd                   # creator only - refunds everyone`}</pre>
      </div>

      <h2 style={{ marginTop: 24 }}>Live pools</h2>
      {pools.length === 0 ? (
        <div className="empty"><div className="big"><InboxIcon size={40} /></div>No pools yet.</div>
      ) : (
        <table className="clean">
          <thead>
            <tr><th>Pool</th><th>Purpose</th><th>Each</th><th>Funded</th><th>Status</th><th>Deadline</th></tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={p.poolId}>
                <td className="mono">{p.poolId}</td>
                <td>{p.purpose}</td>
                <td>{human(p.amountEach)} {p.symbol}</td>
                <td>{p.contributors}/{p.joined}</td>
                <td><span className={`badge ${p.status === 'open' ? 'FUNDED' : p.status === 'paid_out' ? 'RELEASED' : 'CANCELLED'}`}>{p.status}</span></td>
                <td className="muted">{p.status === 'open' ? timeLeft(p.deadlineAt) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
