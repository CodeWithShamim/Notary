import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { parseTokenAmount } from '@unicitylabs/sphere-sdk';
import type { Milestone } from '@notary/shared';
import { dmNotary } from '../lib/notary.js';
import { humanError, uctCoinId } from '../lib/sphere.js';
import { fetchReputation, fetchOffer } from '../lib/api.js';
import { CheckIcon, CloseIcon, PlusCircleIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';
import { useConnect } from '../state/ConnectContext.js';

interface MilestoneRow {
  amount: string;
  deliverable: string;
  hours: string;
}

const emptyRow = (): MilestoneRow => ({ amount: '', deliverable: '', hours: '72' });

export function NewDeal() {
  const { nametag, assets } = useConnect();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const offerId = params.get('offer');

  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [coin, setCoin] = useState('UCT');
  const [deliverable, setDeliverable] = useState('');
  const [hours, setHours] = useState('72');
  const [mode, setMode] = useState<'single' | 'milestones'>('single');
  const [rows, setRows] = useState<MilestoneRow[]>([emptyRow(), emptyRow()]);
  // When opened from an offer, its exact coinId wins over symbol-based resolution.
  const [prefillCoinId, setPrefillCoinId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentPayload, setSentPayload] = useState<string | null>(null);

  const coins = assets.length ? assets : [];
  const selected = coins.find((a) => a.symbol === coin);
  const decimals = selected?.decimals ?? 18;

  // Prefill from a marketplace offer.
  const offer = useQuery({ queryKey: ['offer', offerId], queryFn: () => fetchOffer(offerId!), enabled: !!offerId });
  useEffect(() => {
    const o = offer.data;
    if (!o) return;
    setSeller(o.sellerTag);
    if (o.symbol) setCoin(o.symbol);
    setPrefillCoinId(o.coinId);
    if (o.milestones && o.milestones.length > 1) {
      setMode('milestones');
      setRows(
        o.milestones.map((m) => ({
          amount: safeHuman(m.amount, o.symbol ? undefined : 18),
          deliverable: m.deliverable,
          hours: String(m.deliveryHours ?? 72),
        })),
      );
    } else {
      setMode('single');
      setAmount(safeHuman(o.amount));
      setDeliverable(o.deliverable);
      setHours(String(o.deliveryHours ?? 72));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.data?.offerId]);

  const sellerTag = seller.trim().replace(/^@/, '').toLowerCase();
  const rep = useQuery({
    queryKey: ['reputation', sellerTag],
    queryFn: () => fetchReputation(sellerTag),
    enabled: sellerTag.length >= 3,
  });

  if (!nametag) {
    return (
      <div className="card narrow">
        <h2>Your wallet needs a nametag</h2>
        <p className="muted">
          Deals pay out to nametags - the notary refunds buyers at theirs. Set a nametag in your Sphere wallet,
          then reconnect to open a deal.
        </p>
        <a className="btn" href="https://sphere.unicity.network" target="_blank" rel="noreferrer">Open Sphere wallet</a>
      </div>
    );
  }

  if (sentPayload) {
    return (
      <div className="card wide">
        <h2 className="with-ico">Deal proposed <CheckIcon size={20} className="inline-ico ok" /></h2>
        <p className="muted">
          This exact message was DM'd (NIP-17 encrypted) to @notary - full transparency, no hidden API:
        </p>
        <pre className="json">{JSON.stringify(JSON.parse(sentPayload), null, 2)}</pre>
        <p className="muted">
          The notary is inviting the seller now. Watch it appear under <b>My deals</b> - when the seller
          accepts, a payment request will land here for you to fund the escrow.
        </p>
        <button className="btn" onClick={() => nav('/deals')}>Go to my deals</button>
      </div>
    );
  }

  const coinId = () => prefillCoinId ?? selected?.coinId ?? (coin === 'UCT' ? uctCoinId() : coin);

  const setRow = (i: number, patch: Partial<MilestoneRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 2 ? rs.filter((_, j) => j !== i) : rs));

  const submit = async () => {
    setSending(true);
    setErr(null);
    try {
      if (mode === 'milestones') {
        const milestones: Milestone[] = [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]!;
          if (r.deliverable.trim().length === 0) throw new Error(`Milestone ${i + 1} needs a deliverable.`);
          let base: bigint;
          try {
            base = parseTokenAmount(r.amount.trim(), decimals);
          } catch {
            throw new Error(`Milestone ${i + 1}: "${r.amount}" is not a valid ${coin} amount.`);
          }
          if (base <= 0n) throw new Error(`Milestone ${i + 1} amount must be positive.`);
          milestones.push({ amount: base.toString(), deliverable: r.deliverable.trim(), deliveryHours: Number(r.hours) || 72 });
        }
        const payload = await dmNotary({
          v: 1,
          type: 'deal.open',
          seller: sellerTag,
          coinId: coinId(),
          milestones,
          fromOffer: offerId ?? undefined,
        });
        setSentPayload(payload);
        return;
      }

      let baseUnits: bigint;
      try {
        baseUnits = parseTokenAmount(amount.trim(), decimals);
      } catch {
        throw new Error(`"${amount}" is not a valid ${coin} amount.`);
      }
      if (baseUnits <= 0n) throw new Error('Amount must be positive.');
      const payload = await dmNotary({
        v: 1,
        type: 'deal.open',
        seller: sellerTag,
        amount: baseUnits.toString(),
        coinId: coinId(),
        deliverable: deliverable.trim(),
        deliveryHours: Number(hours) || 72,
        fromOffer: offerId ?? undefined,
      });
      setSentPayload(payload);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  };

  const milestonesValid = rows.every((r) => r.amount.trim() !== '' && r.deliverable.trim().length > 0) && rows.length >= 2;
  const valid =
    seller.trim().length >= 3 && (mode === 'single' ? amount.trim() !== '' && deliverable.trim().length > 0 : milestonesValid);

  const aside = (
    <>
      <AsideCard title="What happens next">
        <ol className="aside-steps">
          <li>
            <b>You propose</b>
            <span className="astep-sub">Your intent is DM'd (encrypted) to @notary — nothing on-chain yet.</span>
          </li>
          <li>
            <b>Seller accepts</b>
            <span className="astep-sub">@notary invites them; they accept or reject the terms.</span>
          </li>
          <li>
            <b>You fund escrow</b>
            <span className="astep-sub">
              A payment request lands in your wallet. {mode === 'milestones' ? 'One milestone at a time.' : 'Funds sit with the notary.'}
            </span>
          </li>
          <li>
            <b>Delivery &amp; release</b>
            <span className="astep-sub">Confirm delivery and the escrow releases to the seller, minus the 1% fee.</span>
          </li>
        </ol>
      </AsideCard>
      <AsideCard title="Good to know">
        <p className="aside-note">Your keys never leave this browser — the site only signs and DMs your intent.</p>
        <p className="aside-note">
          {mode === 'milestones'
            ? 'Staged deals fund and release one milestone at a time — only the active milestone is ever at risk.'
            : "Don't fund and the deal simply expires. No lock-in."}
        </p>
      </AsideCard>
    </>
  );

  return (
    <PageLayout aside={aside}>
      <h1>Open a deal</h1>
      <p className="sub">
        You're the buyer. The notary invites the seller; once they accept you'll get a payment request to fund
        the escrow. Fee: 1% of the escrow, paid from the release.
      </p>
      {offerId && offer.data && (
        <div className="card terminal-card">
          <b>From marketplace offer</b>
          <div className="muted mt-sm">“{offer.data.title}” by @{offer.data.sellerTag} — prefilled below. Review and propose.</div>
        </div>
      )}
      <div className="card">
        <label className="field">
          <span>Seller's nametag</span>
          <input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="@bob" />
        </label>
        {sellerTag.length >= 3 && rep.data && (
          <p className="muted" style={{ marginTop: '-0.4rem' }}>
            {rep.data.dealsAsSeller === 0 ? (
              <>No selling history for @{sellerTag} yet.</>
            ) : (
              <>
                @{sellerTag}: {rep.data.completed} completed
                {rep.data.disputed > 0 && <>, {rep.data.disputed} arbitrated</>}
                {rep.data.ghosted > 0 && <>, {rep.data.ghosted} missed</>}
                {rep.data.completionRate !== null && <> · {Math.round(rep.data.completionRate * 100)}% clean</>}
                {' '}· <Link to="/reputation">details</Link>
              </>
            )}
          </p>
        )}

        <div className="seg" role="tablist" aria-label="Deal structure">
          <button type="button" className={`seg-btn${mode === 'single' ? ' active' : ''}`} onClick={() => setMode('single')}>
            Single delivery
          </button>
          <button type="button" className={`seg-btn${mode === 'milestones' ? ' active' : ''}`} onClick={() => setMode('milestones')}>
            Milestones
          </button>
        </div>

        <div className="grid2">
          <div />
          <label className="field">
            <span>Coin</span>
            <select value={coin} onChange={(e) => { setCoin(e.target.value); setPrefillCoinId(null); }}>
              {coins.length === 0 && <option value="UCT">UCT</option>}
              {coins.map((a) => (
                <option key={a.coinId} value={a.symbol}>{a.symbol}</option>
              ))}
              {prefillCoinId && !coins.some((a) => a.symbol === coin) && <option value={coin}>{coin}</option>}
            </select>
          </label>
        </div>

        {mode === 'single' ? (
          <>
            <label className="field">
              <span>Amount ({coin})</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0001" inputMode="decimal" />
            </label>
            <label className="field">
              <span>What is being delivered?</span>
              <textarea value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder="Logo design - 3 concepts, source files included" />
            </label>
            <label className="field">
              <span>Delivery window (hours after funding)</span>
              <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" />
            </label>
          </>
        ) : (
          <>
            <p className="muted">
              Stage the work — e.g. 30% up front, 40% on draft, 30% on final. Each milestone is funded, delivered
              and released in order; only the active one is ever escrowed.
            </p>
            {rows.map((r, i) => (
              <div key={i} className="milestone-row">
                <div className="spread">
                  <b>Milestone {i + 1}</b>
                  {rows.length > 2 && (
                    <button type="button" className="icon-btn" aria-label={`Remove milestone ${i + 1}`} onClick={() => removeRow(i)}>
                      <CloseIcon size={14} />
                    </button>
                  )}
                </div>
                <div className="grid2">
                  <label className="field">
                    <span>Amount ({coin})</span>
                    <input value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="0.0001" inputMode="decimal" />
                  </label>
                  <label className="field">
                    <span>Delivery window (h)</span>
                    <input value={r.hours} onChange={(e) => setRow(i, { hours: e.target.value })} inputMode="numeric" />
                  </label>
                </div>
                <label className="field">
                  <span>Deliverable</span>
                  <textarea value={r.deliverable} onChange={(e) => setRow(i, { deliverable: e.target.value })} placeholder="Draft concepts…" />
                </label>
              </div>
            ))}
            <button type="button" className="btn secondary" onClick={addRow}>
              <span className="btn-ico"><PlusCircleIcon size={16} /> Add milestone</span>
            </button>
          </>
        )}

        {err && <p className="error-text">{err}</p>}
        <button className="btn" disabled={!valid || sending} onClick={() => void submit()}>
          {sending ? <span className="spinner" /> : 'Propose deal to @notary'}
        </button>
      </div>
    </PageLayout>
  );
}

/** Base-units → display string, tolerating garbage (used only to prefill inputs). */
function safeHuman(base: string, decimals = 18): string {
  try {
    const b = BigInt(base);
    if (b === 0n) return '0';
    const d = BigInt(10) ** BigInt(decimals);
    const whole = b / d;
    const frac = b % d;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole}.${fracStr}`;
  } catch {
    return base;
  }
}
