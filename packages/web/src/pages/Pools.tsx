import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPools, type Pool } from '../lib/api.js';
import { watchPoolGroup } from '../lib/notary.js';
import { humanError } from '../lib/sphere.js';
import { human, timeLeft } from '../lib/format.js';
import { InboxIcon, LayersIcon, CheckIcon, CopyIcon, ClockIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';
import { useConnect } from '../state/ConnectContext.js';
import { useMeta } from '../lib/meta.js';

type Filter = 'all' | 'open' | 'paid_out' | 'ended';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'paid_out', label: 'Paid out' },
  { key: 'ended', label: 'Refunded' },
];

const STATUS_BADGE: Record<Pool['status'], string> = {
  open: 'FUNDED',
  paid_out: 'RELEASED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
};

const STATUS_LABEL: Record<Pool['status'], string> = {
  open: 'open',
  paid_out: 'paid out',
  cancelled: 'cancelled',
  expired: 'expired',
};

const COMMANDS: { cmd: string; note: string }[] = [
  { cmd: '!pool create 20000 UCT Team pizza fund', note: 'start a pool — 20000 base units each' },
  { cmd: '!pool join pool_ab12cd', note: 'get a payment request in your wallet' },
  { cmd: '!pool status pool_ab12cd', note: 'funding progress' },
  { cmd: '!pool payout pool_ab12cd @carol', note: 'creator only — pays pot minus fee' },
  { cmd: '!pool cancel pool_ab12cd', note: 'creator only — refunds everyone' },
];

export function Pools() {
  useMeta({
    title: 'Pools',
    description:
      'Crowd-funded escrow pools on Notary — many contributors fund one deal together, with the @notary agent collecting and settling automatically.',
  });
  const { nametag } = useConnect();
  const { data, isLoading } = useQuery({ queryKey: ['pools'], queryFn: fetchPools, refetchInterval: 15_000 });
  const [filter, setFilter] = useState<Filter>('all');
  const pools = useMemo(() => data?.pools ?? [], [data]);

  const counts = useMemo(() => {
    const open = pools.filter((p) => p.status === 'open').length;
    const paidOut = pools.filter((p) => p.status === 'paid_out').length;
    const ended = pools.filter((p) => p.status === 'cancelled' || p.status === 'expired').length;
    return { open, paidOut, ended };
  }, [pools]);

  const visible = useMemo(() => {
    const rows = pools.filter((p) => {
      if (filter === 'all') return true;
      if (filter === 'ended') return p.status === 'cancelled' || p.status === 'expired';
      return p.status === filter;
    });
    // Open pools first, then most recent.
    return rows.sort((a, b) => {
      if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [pools, filter]);

  const totalContributions = useMemo(
    () => pools.reduce((n, p) => n + p.contributors, 0),
    [pools],
  );

  const aside = (
    <>
      <AsideCard title="At a glance">
        <div className="aside-stats">
          <div className="aside-stat"><span className="k">Open pools</span><span className="v gold">{counts.open}</span></div>
          <div className="aside-stat"><span className="k">Paid out</span><span className="v">{counts.paidOut}</span></div>
          <div className="aside-stat"><span className="k">Total tracked</span><span className="v">{pools.length}</span></div>
          <div className="aside-stat"><span className="k">Contributions</span><span className="v">{totalContributions}</span></div>
        </div>
      </AsideCard>
      <AsideCard title="Invite the notary">
        <p className="aside-note">
          Pools run inside NIP-29 group chats. DM <code>!pool watch &lt;groupId&gt;</code> to @notary to have it
          watch yours, then run the commands below in the group.
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

      {nametag && <InviteNotary />}

      <div className="card">
        <h2 className="with-ico">How to run one <span className="badge">chat-native</span></h2>
        <p className="muted">
          v1 lives in the group chat. Invite @notary, then paste any of these — click a line to copy it.
        </p>
        <ul className="cmd-list">
          {COMMANDS.map((c) => (
            <CommandRow key={c.cmd} cmd={c.cmd} note={c.note} />
          ))}
        </ul>
      </div>

      <div className="spread mt-xl pools-head">
        <h2>Live pools</h2>
        <div className="seg" role="tablist" aria-label="Filter pools">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`seg-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="big"><InboxIcon size={40} /></div>
          {pools.length === 0 ? 'No pools yet.' : 'No pools match this filter.'}
        </div>
      ) : (
        <div className="pool-grid">
          {visible.map((p) => (
            <PoolCard key={p.poolId} pool={p} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function PoolCard({ pool }: { pool: Pool }) {
  const denom = pool.symbol ?? pool.coinId.slice(0, 8);
  // Contributors that have actually paid in / everyone who has joined.
  const funded = pool.joined > 0 ? Math.round((pool.contributors / pool.joined) * 100) : 0;
  const isOpen = pool.status === 'open';

  return (
    <div className="card pool-card">
      <div className="spread">
        <span className="mono pool-id"><LayersIcon size={14} className="inline-ico" /> {pool.poolId}</span>
        <span className={`badge ${STATUS_BADGE[pool.status]}`}>{STATUS_LABEL[pool.status]}</span>
      </div>
      <p className="pool-purpose">{pool.purpose}</p>

      <div className="pool-meter" role="progressbar" aria-valuenow={funded} aria-valuemin={0} aria-valuemax={100}>
        <div className={`pool-meter-fill ${isOpen ? '' : 'done'}`} style={{ width: `${Math.min(100, funded)}%` }} />
      </div>
      <div className="pool-meter-label muted">
        {pool.contributors} paid · {pool.joined} joined
      </div>

      <div className="aside-kv">
        <div className="kv"><span className="k">Each</span><span className="v">{human(pool.amountEach)} {denom}</span></div>
        <div className="kv"><span className="k">Pot so far</span><span className="v gold">{human(pool.pot)} {denom}</span></div>
        <div className="kv">
          <span className="k">{isOpen ? 'Deadline' : 'Status'}</span>
          <span className="v muted">
            {isOpen ? <><ClockIcon size={13} className="inline-ico" /> {timeLeft(pool.deadlineAt)}</> : STATUS_LABEL[pool.status]}
          </span>
        </div>
      </div>
    </div>
  );
}

function InviteNotary() {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSending(true);
    setErr(null);
    try {
      await watchPoolGroup(groupId);
      setDone(true);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  };

  const valid = groupId.trim().length > 0;

  if (!open) {
    return (
      <div className="card">
        <div className="spread">
          <div>
            <h2>Starting a pool?</h2>
            <p className="muted">Invite @notary into your NIP-29 group, then run <code>!pool create</code> there.</p>
          </div>
          <button className="btn" onClick={() => { setOpen(true); setDone(false); }}>Invite the notary</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="with-ico">Invite the notary {done && <ClockIcon size={17} className="inline-ico" />}</h2>
      {done ? (
        <p className="muted">
          Invite sent — but @notary only joins if the group id is valid. <b>Watch your DMs</b>: it replies
          “Watching group…” on success or “Could not join that group.” if not. Once it confirms, run{' '}
          <code>!pool create &lt;amount&gt; &lt;coin&gt; &lt;purpose&gt;</code> in that group and the pool appears below.
        </p>
      ) : (
        <p className="muted">
          Send a control DM asking @notary to watch a group for <code>!pool</code> commands. Paste the group's
          NIP-29 id (from your group chat client).
        </p>
      )}
      <label className="field">
        <span>Group id</span>
        <input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="relay'groupid or raw group id" />
      </label>
      {err && <p className="error-text">{err}</p>}
      <div className="row">
        <button className="btn" disabled={!valid || sending} onClick={() => void submit()}>
          {sending ? <span className="spinner" /> : 'Send invite to @notary'}
        </button>
        <button className="btn secondary" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>
  );
}

function CommandRow({ cmd, note }: { cmd: string; note: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <li className="cmd-row" onClick={copy} title="Click to copy">
      <code className="cmd-text">{cmd}</code>
      <span className="cmd-note muted">{note}</span>
      <span className="cmd-copy" aria-hidden>
        {copied ? <CheckIcon size={15} className="ok" /> : <CopyIcon size={15} />}
      </span>
    </li>
  );
}
