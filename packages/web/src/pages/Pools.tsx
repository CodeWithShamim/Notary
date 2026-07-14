import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../lib/api.js';
import { human, timeLeft } from '../lib/format.js';
import { InboxIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';

export function Pools() {
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: fetchStatus });
  const pools = status?.pools ?? [];
  const openCount = pools.filter((p) => p.status === 'open').length;

  const aside = (
    <>
      <AsideCard title="At a glance">
        <div className="aside-stats">
          <div className="aside-stat"><span className="k">Open pools</span><span className="v gold">{openCount}</span></div>
          <div className="aside-stat"><span className="k">Total tracked</span><span className="v">{pools.length}</span></div>
        </div>
      </AsideCard>
      <AsideCard title="Invite the notary">
        <p className="aside-note">
          Pools run inside NIP-29 group chats. DM <code>!pool watch &lt;groupId&gt;</code> to @notary to have it
          watch yours, then use the commands on the left.
        </p>
      </AsideCard>
    </>
  );

  return (
    <PageLayout aside={aside}>
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

      <h2 className="mt-xl">Live pools</h2>
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
    </PageLayout>
  );
}
