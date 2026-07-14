import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLeaderboard, fetchReputation, type Reputation as Rep } from '../lib/api.js';
import { SearchIcon, ScaleIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';
import { Pagination, usePaginated } from '../components/Pagination.js';
import { human, when } from '../lib/format.js';
import { useMeta } from '../lib/meta.js';

function rate(r: Rep): string {
  return r.completionRate === null ? '—' : `${Math.round(r.completionRate * 100)}%`;
}

function RepCard({ r }: { r: Rep }) {
  const finished = r.completed + r.disputed + r.ghosted;
  return (
    <div className="card">
      <div className="spread">
        <h2 className="with-ico" style={{ margin: 0 }}>@{r.tag}</h2>
        {finished > 0 && <span className={`badge lg ${r.completionRate === 1 ? 'RELEASED' : r.ghosted > 0 ? 'REFUNDED' : ''}`}>{rate(r)} clean</span>}
      </div>
      <div className="aside-kv mt-md">
        <div className="kv"><span className="k">Deals as seller</span><span className="v">{r.dealsAsSeller}</span></div>
        <div className="kv"><span className="k">Deals as buyer</span><span className="v">{r.dealsAsBuyer}</span></div>
        <div className="kv"><span className="k">Completed cleanly</span><span className="v">{r.completed}</span></div>
        <div className="kv"><span className="k">Went to arbitration</span><span className="v">{r.disputed}</span></div>
        <div className="kv"><span className="k">Missed delivery</span><span className="v">{r.ghosted}</span></div>
        {r.volumeSettled.map((v) => (
          <div className="kv" key={v.symbol}><span className="k">Volume settled</span><span className="v gold">{human(v.total)} {v.symbol}</span></div>
        ))}
        {r.lastActive && <div className="kv"><span className="k">Last active</span><span className="v">{when(r.lastActive)}</span></div>}
      </div>
    </div>
  );
}

export function Reputation() {
  useMeta({
    title: 'Reputation',
    description:
      'On-chain reputation on Notary — completion rates, disputes and a leaderboard of traders, computed from every deal the @notary agent has settled.',
  });
  const [tag, setTag] = useState('');
  const [lookup, setLookup] = useState<string | null>(null);
  const board = useQuery({ queryKey: ['leaderboard'], queryFn: fetchLeaderboard });
  const single = useQuery({
    queryKey: ['reputation', lookup],
    queryFn: () => fetchReputation(lookup!),
    enabled: lookup !== null,
  });
  const leaders = board.data?.reputations ?? [];
  const { page, setPage, pageCount, pageItems, pageSize, total } = usePaginated(leaders, 10);

  const aside = (
    <AsideCard title="How it's earned">
      <p className="aside-note">
        Reputation is <b>derived, not claimed</b>. Every deal is a registered nametag and every settlement is
        recorded, so the notary can compute a track record no one can fake.
      </p>
      <p className="aside-note">
        <b>Completed cleanly</b> = released on confirmation. <b>Arbitration</b> = a dispute the AI arbiter split.
        <b> Missed delivery</b> = a funded deal the seller ghosted.
      </p>
    </AsideCard>
  );

  return (
    <PageLayout aside={aside}>
      <h1 className="with-ico"><ScaleIcon size={26} className="inline-ico" /> Reputation</h1>
      <p className="sub">Check any trader's track record before you open a deal with them.</p>

      <div className="card">
        <div className="row">
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="@nametag"
            onKeyDown={(e) => e.key === 'Enter' && tag.trim() && setLookup(tag.trim())}
            style={{ flex: 1 }}
          />
          <button className="btn" disabled={!tag.trim()} onClick={() => setLookup(tag.trim())}>
            <span className="btn-ico">Look up <SearchIcon size={16} /></span>
          </button>
        </div>
      </div>

      {lookup && single.data && (
        single.data.dealsAsBuyer + single.data.dealsAsSeller === 0 ? (
          <div className="empty"><div className="big"><SearchIcon size={36} /></div>@{single.data.tag} has no deals on record yet.</div>
        ) : (
          <RepCard r={single.data} />
        )
      )}

      <h2 className="mt-lg">Most active traders</h2>
      {board.isLoading && <p className="muted">Loading…</p>}
      {board.data && total === 0 && <p className="muted">No deals on record yet.</p>}
      {pageItems.map((r) => <RepCard key={r.tag} r={r} />)}
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onChange={setPage} />
    </PageLayout>
  );
}
