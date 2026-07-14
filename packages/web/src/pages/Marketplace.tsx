import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseTokenAmount } from '@unicitylabs/sphere-sdk';
import type { Offer } from '@notary/shared';
import { fetchOffers } from '../lib/api.js';
import { dmNotary } from '../lib/notary.js';
import { humanError, uctCoinId } from '../lib/sphere.js';
import { human, timeLeft } from '../lib/format.js';
import { SearchIcon, CheckIcon, ArrowRightIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';
import { useConnect } from '../state/ConnectContext.js';

export function Marketplace() {
  const { nametag, assets } = useConnect();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers, refetchInterval: 15_000 });
  const offers = data?.offers ?? [];

  const aside = (
    <>
      <AsideCard title="How discovery works">
        <ol className="aside-steps">
          <li>
            <b>Sellers list</b>
            <span className="astep-sub">Post "I'll do X for Y". Your offer is DM'd to @notary, which curates it and mirrors it to the Unicity intent market.</span>
          </li>
          <li>
            <b>Buyers browse</b>
            <span className="astep-sub">No need to know a nametag up front — open a fully-prefilled escrow deal straight from a listing.</span>
          </li>
          <li>
            <b>@notary escrows</b>
            <span className="astep-sub">The deal runs the same trustless flow: fund → deliver → confirm → release.</span>
          </li>
        </ol>
      </AsideCard>
      <AsideCard title="Good to know">
        <p className="aside-note">A listing is just a hint. Opening a deal still validates the seller's nametag and amount — the price you fund is the one you confirm in your wallet.</p>
      </AsideCard>
    </>
  );

  return (
    <PageLayout aside={aside}>
      <h1>Marketplace</h1>
      <p className="sub">
        Sellers post what they'll do and for how much; buyers open an escrowed deal from a listing in one click.
        This closes the "how do two strangers find each other" gap — no nametag needed up front.
      </p>

      {nametag && <PostOffer nametag={nametag} assets={assets} onPosted={() => qc.invalidateQueries({ queryKey: ['offers'] })} />}

      <h2 className="mt-xl">Open offers</h2>
      {isLoading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : offers.length === 0 ? (
        <div className="empty"><div className="big"><SearchIcon size={40} /></div>No open offers yet. Be the first to post one.</div>
      ) : (
        <div className="offer-grid">
          {offers.map((o) => (
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
    </PageLayout>
  );
}

function OfferCard({ offer, mine, onOpen, onClosed }: { offer: Offer; mine: boolean; onOpen: () => void; onClosed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
    <div className="card offer-card">
      <div className="spread">
        <h3 className="offer-title">{offer.title}</h3>
        {staged && <span className="badge">{offer.milestones!.length} milestones</span>}
      </div>
      <p className="muted offer-deliverable">{offer.deliverable}</p>
      <div className="aside-kv">
        <div className="kv"><span className="k">Seller</span><span className="v">@{offer.sellerTag}</span></div>
        <div className="kv"><span className="k">Price</span><span className="v gold">{human(offer.amount)} {offer.symbol ?? ''}</span></div>
        <div className="kv"><span className="k">Delivery</span><span className="v">{offer.deliveryHours}h{staged ? ' (first stage)' : ''}</span></div>
        <div className="kv"><span className="k">Listed until</span><span className="v muted">{timeLeft(offer.expiresAt)}</span></div>
      </div>
      {err && <p className="error-text">{err}</p>}
      <div className="row">
        {mine ? (
          <button className="btn secondary" disabled={busy} onClick={() => void close()}>
            {busy ? <span className="spinner" /> : 'Close listing'}
          </button>
        ) : (
          <button className="btn" onClick={onOpen}>
            <span className="btn-ico">Open a deal <ArrowRightIcon size={16} /></span>
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
      <div className="card">
        <div className="spread">
          <div>
            <h2>Selling something?</h2>
            <p className="muted">Post a public offer as <b>@{nametag}</b>. Buyers open an escrowed deal from it.</p>
          </div>
          <button className="btn" onClick={() => { setOpen(true); setDone(false); }}>Post an offer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="with-ico">Post an offer {done && <CheckIcon size={18} className="inline-ico ok" />}</h2>
      {done && <p className="muted">Your offer is live. It appears below and is mirrored to the intent market. Post another or collapse this panel.</p>}
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
        <button className="btn" disabled={!valid || sending} onClick={() => void submit()}>
          {sending ? <span className="spinner" /> : 'Post offer to @notary'}
        </button>
        <button className="btn secondary" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>
  );
}
