import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseTokenAmount } from '@unicitylabs/sphere-sdk';
import { dmNotary } from '../lib/notary.js';
import { humanError, uctCoinId } from '../lib/sphere.js';
import { CheckIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';
import { useConnect } from '../state/ConnectContext.js';

export function NewDeal() {
  const { nametag, assets } = useConnect();
  const nav = useNavigate();
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('');
  const [coin, setCoin] = useState('UCT');
  const [deliverable, setDeliverable] = useState('');
  const [hours, setHours] = useState('72');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentPayload, setSentPayload] = useState<string | null>(null);

  const coins = assets.length ? assets : [];
  const selected = coins.find((a) => a.symbol === coin);
  const decimals = selected?.decimals ?? 18;

  if (!nametag) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
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
      <div className="card" style={{ maxWidth: 640 }}>
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
      if (baseUnits <= 0n) throw new Error('Amount must be positive.');
      const payload = await dmNotary({
        v: 1,
        type: 'deal.open',
        seller: seller.trim().replace(/^@/, ''),
        amount: baseUnits.toString(),
        coinId: selected?.coinId ?? (coin === 'UCT' ? uctCoinId() : coin),
        deliverable: deliverable.trim(),
        deliveryHours: Number(hours) || 72,
      });
      setSentPayload(payload);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  };

  const valid = seller.trim().length >= 3 && amount.trim() !== '' && deliverable.trim().length > 0;

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
            <span className="astep-sub">A payment request lands in your wallet. Funds sit with the notary.</span>
          </li>
          <li>
            <b>Delivery &amp; release</b>
            <span className="astep-sub">Confirm delivery and the escrow releases to the seller, minus the 1% fee.</span>
          </li>
        </ol>
      </AsideCard>
      <AsideCard title="Good to know">
        <p className="aside-note">Your keys never leave this browser — the site only signs and DMs your intent.</p>
        <p className="aside-note">Don't fund and the deal simply expires. No lock-in.</p>
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
      <div className="card">
        <label className="field">
          <span>Seller's nametag</span>
          <input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="@bob" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Amount ({coin})</span>
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
          <span>What is being delivered?</span>
          <textarea value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder="Logo design - 3 concepts, source files included" />
        </label>
        <label className="field">
          <span>Delivery window (hours after funding)</span>
          <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" />
        </label>
        {err && <p className="error-text">{err}</p>}
        <button className="btn" disabled={!valid || sending} onClick={() => void submit()}>
          {sending ? <span className="spinner" /> : 'Propose deal to @notary'}
        </button>
      </div>
    </PageLayout>
  );
}
