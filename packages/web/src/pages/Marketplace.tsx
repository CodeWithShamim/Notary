import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseTokenAmount } from '@unicitylabs/sphere-sdk';
import type { Offer } from '@notary/shared';
import { fetchOffers } from '../lib/api.js';
import { dmNotary } from '../lib/notary.js';
import { humanError, uctCoinId } from '../lib/sphere.js';
import { human, timeLeft } from '../lib/format.js';
import { SearchIcon, CheckIcon, ArrowRightIcon, UserIcon, ClockIcon } from '../components/Icon.js';
import { useConnect } from '../state/ConnectContext.js';
import { useMeta } from '../lib/meta.js';

/* Real offers carry status open | closed | expired. Map each onto the
   marketplace's visual vocabulary (a coloured dot + label). */
const STATUS_META: Record<Offer['status'], { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'open' },
  closed: { label: 'Closed', tone: 'done' },
  expired: { label: 'Expired', tone: 'dead' },
};

export function Marketplace() {
  useMeta({
    title: 'Marketplace',
    description:
      'Browse open escrow offers on Notary and hire a seller in one click — every deal is settled by the autonomous @notary agent on Unicity.',
  });
  const { nametag, assets } = useConnect();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers, refetchInterval: 15_000 });
  const offers = data?.offers ?? [];

  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return offers;
    return offers.filter((o) => `${o.title} ${o.deliverable} ${o.sellerTag}`.toLowerCase().includes(needle));
  }, [offers, q]);

  return (
    <div className="mkt">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="mkt-hero">
        <div className="mkt-eyebrow">Open Marketplace</div>
        <h1 className="mkt-title">
          Marketplace
          <span className="mkt-pulse" aria-hidden="true"><i /></span>
        </h1>
        <p className="mkt-sub">
          Sellers post what they'll do and for how much; buyers open an escrowed deal from a listing in one click.
          This closes the “how do two strangers find each other” gap — no nametag needed up front.
        </p>
      </header>

      <div className="mkt-body">
        <div className="mkt-main">
          {nametag && (
            <PostOffer
              nametag={nametag}
              assets={assets}
              onPosted={() => qc.invalidateQueries({ queryKey: ['offers'] })}
            />
          )}

          <div className="mkt-openbar">
            <h2 className="mkt-section-title">Open offers</h2>
            {offers.length > 0 && (
              <div className="mkt-search">
                <SearchIcon size={17} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search offers…" />
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="mkt-empty"><span className="spinner" /></div>
          ) : visible.length === 0 ? (
            <div className="mkt-empty">
              <div className="mkt-empty-ico"><SearchIcon size={38} /></div>
              {offers.length === 0 ? 'No open offers yet. Be the first to post one.' : 'No offers match your search.'}
            </div>
          ) : (
            <div className="mkt-grid">
              {visible.map((o) => (
                <OfferCard
                  key={o.offerId}
                  offer={o}
                  mine={o.sellerTag.toLowerCase() === nametag?.toLowerCase()}
                  onOpen={() => nav(`/new?offer=${encodeURIComponent(o.offerId)}`)}
                  onClosed={() => qc.invalidateQueries({ queryKey: ['offers'] })}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Contextual aside ───────────────────────────────── */}
        <aside className="mkt-aside">
          <section className="mkt-panel">
            <div className="mkt-panel-title">How discovery works</div>
            <ol className="mkt-steps">
              <li>
                <b>Sellers list</b>
                <span>Post “I'll do X for Y”. Your offer is DM'd to @notary, which curates it and mirrors it to the Unicity intent market.</span>
              </li>
              <li>
                <b>Buyers browse</b>
                <span>No need to know a nametag up front — open a fully-prefilled escrow deal straight from a listing.</span>
              </li>
              <li>
                <b>@notary escrows</b>
                <span>The deal runs the same trustless flow: fund → deliver → confirm → release.</span>
              </li>
            </ol>
          </section>
          <section className="mkt-panel">
            <div className="mkt-panel-title">Good to know</div>
            <p className="mkt-panel-note">
              A listing is just a hint. Opening a deal still validates the seller's nametag and amount — the price you
              fund is the one you confirm in your wallet.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  mine,
  onOpen,
  onClosed,
}: {
  offer: Offer;
  mine: boolean;
  onOpen: () => void;
  onClosed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const meta = STATUS_META[offer.status];
  const staged = offer.milestones && offer.milestones.length > 1;

  const close = async () => {
    setBusy(true);
    setErr(null);
    try {
      await dmNotary({ v: 1, type: 'offer.close', offerId: offer.offerId });
      onClosed();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mkt-card">
      <div className="mkt-card-top">
        <span className={`mkt-status dot-${meta.tone}`}>
          <i className="mkt-chip-dot" /> {meta.label}
        </span>
        {staged && <span className="mkt-tag">{offer.milestones!.length} milestones</span>}
      </div>

      <h3 className="mkt-card-title">{offer.title}</h3>
      <p className="mkt-card-desc">{offer.deliverable}</p>

      <div className="mkt-card-price">
        {human(offer.amount)} <span>{offer.symbol ?? ''}</span>
      </div>

      <dl className="mkt-kv">
        <div><dt><UserIcon size={13} /> Seller</dt><dd>{mine ? 'You' : `@${offer.sellerTag}`}</dd></div>
        <div><dt><ClockIcon size={13} /> Delivery</dt><dd>{offer.deliveryHours}h{staged ? ' (first stage)' : ''}</dd></div>
        <div><dt>Listed until</dt><dd className="dim">{timeLeft(offer.expiresAt)}</dd></div>
      </dl>

      {err && <p className="error-text">{err}</p>}

      <div className="mkt-card-foot">
        {mine ? (
          <button className="mkt-btn ghost block" disabled={busy} onClick={() => void close()}>
            {busy ? <span className="spinner" /> : 'Close listing'}
          </button>
        ) : (
          <button className="mkt-btn primary block" onClick={onOpen}>
            Open a deal <ArrowRightIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function PostOffer({
  nametag,
  assets,
  onPosted,
}: {
  nametag: string;
  assets: { symbol: string; coinId: string; decimals: number }[];
  onPosted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [coin, setCoin] = useState('UCT');
  const [deliverable, setDeliverable] = useState('');
  const [hours, setHours] = useState('72');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const coins = assets.length ? assets : [];
  const selected = coins.find((a) => a.symbol === coin);
  const decimals = selected?.decimals ?? 18;

  const submit = async () => {
    setSending(true);
    setErr(null);
    try {
      let baseUnits: bigint;
      try {
        baseUnits = parseTokenAmount(amount.trim(), decimals);
      } catch {
        throw new Error(`"${amount}" is not a valid ${coin} amount.`);
      }
      if (baseUnits <= 0n) throw new Error('Price must be positive.');
      await dmNotary({
        v: 1,
        type: 'offer.post',
        title: title.trim(),
        amount: baseUnits.toString(),
        coinId: selected?.coinId ?? (coin === 'UCT' ? uctCoinId() : coin),
        deliverable: deliverable.trim(),
        deliveryHours: Number(hours) || 72,
      });
      setDone(true);
      setTitle('');
      setAmount('');
      setDeliverable('');
      onPosted();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  };

  const valid = title.trim().length >= 3 && amount.trim() !== '' && deliverable.trim().length > 0;

  if (!open) {
    return (
      <div className="mkt-sell">
        <div>
          <h2>Selling something?</h2>
          <p className="muted">Post a public offer as <b>@{nametag}</b>. Buyers open an escrowed deal from it.</p>
        </div>
        <button className="mkt-btn primary" onClick={() => { setOpen(true); setDone(false); }}>Post an offer</button>
      </div>
    );
  }

  return (
    <div className="mkt-post">
      <div className="mkt-post-head">
        <h2 className="with-ico">Post an offer {done && <CheckIcon size={18} className="inline-ico ok" />}</h2>
        {done && <p className="muted">Your offer is live. It appears below and is mirrored to the intent market. Post another or collapse this panel.</p>}
      </div>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Logo design — 3 concepts in 48h" maxLength={120} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Price ({coin})</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0001" inputMode="decimal" />
        </label>
        <label className="field">
          <span>Coin</span>
          <select value={coin} onChange={(e) => setCoin(e.target.value)}>
            {coins.length === 0 && <option value="UCT">UCT</option>}
            {coins.map((a) => (
              <option key={a.coinId} value={a.symbol}>{a.symbol}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>What will you deliver?</span>
        <textarea value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder="3 logo concepts, source files, one revision round" />
      </label>
      <label className="field">
        <span>Delivery window (hours after funding)</span>
        <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" />
      </label>
      {err && <p className="error-text">{err}</p>}
      <div className="row">
        <button className="mkt-btn primary" disabled={!valid || sending} onClick={() => void submit()}>
          {sending ? <span className="spinner" /> : 'Post offer to @notary'}
        </button>
        <button className="mkt-btn ghost" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>
  );
}
