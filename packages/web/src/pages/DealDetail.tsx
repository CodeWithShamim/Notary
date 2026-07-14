import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HAPPY_PATH, type DealState } from '@notary/shared';
import { fetchDealTrail } from '../lib/api.js';
import { human, timeLeft, when } from '../lib/format.js';
import { dmNotary } from '../lib/notary.js';
import { humanError } from '../lib/sphere.js';
import { useConnect } from '../state/ConnectContext.js';

const TERMINAL_LABEL: Partial<Record<string, string>> = {
  RELEASED: 'Released to seller',
  REFUNDED: 'Refunded to buyer',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired unfunded',
};

export function DealDetail() {
  const { dealId = '' } = useParams();
  const { deals, nametag, fundEscrow } = useConnect();
  const stored = deals[dealId];
  const { data: trail } = useQuery({
    queryKey: ['trail', dealId],
    queryFn: () => fetchDealTrail(dealId),
    enabled: dealId !== '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);

  const snap = stored?.snapshot;
  // Merge: DM snapshot is richer; the public API trail keeps us honest if DMs lag.
  const state = (snap?.state ?? trail?.state ?? 'PROPOSED') as DealState;
  if (!snap && !trail) {
    return <div className="empty"><div className="big">🔎</div>Deal {dealId} isn't known to this browser yet.</div>;
  }

  const isBuyer = snap?.buyerTag?.toLowerCase() === nametag?.toLowerCase();
  const isSeller = snap?.sellerTag?.toLowerCase() === nametag?.toLowerCase();

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(null);
    }
  };

  const path: DealState[] = [...HAPPY_PATH];
  const stepIndex =
    state === 'RELEASED' ? path.length - 1 :
    state === 'REFUNDED' || state === 'CANCELLED' || state === 'EXPIRED' ? -1 :
    path.indexOf(state);

  const events = (snap?.events ?? trail?.events ?? []) as { at: number; event: string; detail?: string }[];

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="spread">
        <h1 className="mono" style={{ fontSize: 24 }}>{dealId}</h1>
        <span className={`badge ${state}`} style={{ fontSize: 14 }}>{state.replace(/_/g, ' ')}</span>
      </div>
      <p className="sub" style={{ marginBottom: 8 }}>{snap?.deliverable}</p>
      <p className="muted">
        {snap && <>@{snap.buyerTag} (buyer) ⇄ @{snap.sellerTag} (seller) · </>}
        <b style={{ color: 'var(--gold)' }}>{human(snap?.amount ?? trail?.amount ?? '0')} {snap?.symbol ?? trail?.symbol ?? ''}</b>
        {' '}· fee {(snap?.feeBps ?? trail?.feeBps ?? 100) / 100}%
        {(snap?.deadlineAt ?? trail?.deadlineAt) && state !== 'RELEASED' && state !== 'REFUNDED' && (
          <> · ⏱ {timeLeft(snap?.deadlineAt ?? trail?.deadlineAt ?? null)} left</>
        )}
      </p>

      {/* stepper */}
      {stepIndex >= 0 ? (
        <div className="stepper">
          {path.map((s, i) => (
            <span key={s} style={{ display: 'contents' }}>
              {i > 0 && <span className="step-line" />}
              <span className={`step ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}`}>
                <span className="dot">{i < stepIndex ? '✓' : i + 1}</span>
                <span className="lbl">{s.replace(/_/g, ' ')}</span>
              </span>
            </span>
          ))}
        </div>
      ) : (
        <div className="card" style={{ margin: '18px 0', borderColor: state === 'REFUNDED' ? 'var(--blue)' : 'var(--red)' }}>
          <b>{TERMINAL_LABEL[state] ?? state}</b>
          {snap?.settlement && (
            <div className="muted" style={{ marginTop: 6 }}>
              {snap.settlement.toBuyer && <>↩ {human(snap.settlement.toBuyer)} returned to @{snap.buyerTag} · </>}
              {snap.settlement.fee && <>fee retained {human(snap.settlement.fee)}</>}
            </div>
          )}
        </div>
      )}

      {/* fund escrow card — the star of the buyer flow */}
      {state === 'AWAITING_FUNDS' && isBuyer && snap && (
        <div className="pay-card">
          <h2 style={{ marginTop: 0 }}>Fund escrow — pay {human(snap.amount)} {snap.symbol ?? ''}</h2>
          <p className="muted">
            Your wallet transfers the escrow amount to @notary, tagged with this deal id. Funds stay with the
            notary until delivery is confirmed, disputed, or timed out — the agent settles on its own either way.
            Don't fund and the deal simply expires.
          </p>
          {err && <p className="error-text">{err}</p>}
          <div className="row">
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => void act('pay', () =>
                fundEscrow({ dealId, amount: snap.amount, coinId: snap.coinId }),
              )}
            >
              {busy === 'pay' ? <span className="spinner" /> : `Pay ${human(snap.amount)} ${snap.symbol ?? ''} into escrow`}
            </button>
          </div>
        </div>
      )}

      {/* seller: accept / reject invite */}
      {state === 'PROPOSED' && isSeller && (
        <div className="card">
          <h2>You've been named as the seller</h2>
          <p className="muted">Accept and the buyer is asked to fund {human(snap?.amount ?? '0')} {snap?.symbol ?? ''} into escrow before you start work.</p>
          {err && <p className="error-text">{err}</p>}
          <div className="row">
            <button className="btn" disabled={busy !== null} onClick={() => void act('accept', () => dmNotary({ v: 1, type: 'deal.accept', dealId }))}>
              {busy === 'accept' ? <span className="spinner" /> : 'Accept deal'}
            </button>
            <button className="btn danger" disabled={busy !== null} onClick={() => void act('reject', () => dmNotary({ v: 1, type: 'deal.reject', dealId }))}>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* seller: mark delivered */}
      {state === 'FUNDED' && isSeller && (
        <div className="card">
          <h2>Escrow is funded — deliver the goods</h2>
          <label className="field">
            <span>Proof of delivery (optional URL or hash)</span>
            <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://…" />
          </label>
          {err && <p className="error-text">{err}</p>}
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => void act('delivered', () => dmNotary({ v: 1, type: 'deal.delivered', dealId, proof: proof.trim() || undefined }))}
          >
            {busy === 'delivered' ? <span className="spinner" /> : 'Mark as delivered'}
          </button>
        </div>
      )}

      {/* buyer: confirm / dispute */}
      {state === 'DELIVERED_CLAIMED' && isBuyer && (
        <div className="card">
          <h2>The seller says it's delivered{snap?.events?.some((e) => e.event === 'DELIVERED') ? '' : ''}</h2>
          <p className="muted">
            Confirm to release {human(snap?.amount ?? '0')} {snap?.symbol ?? ''} (minus fee) to @{snap?.sellerTag}. Silence past
            the deadline counts as acceptance. Disputing (v1 rule) refunds you minus a small dispute fee.
          </p>
          {err && <p className="error-text">{err}</p>}
          {!showDispute ? (
            <div className="row">
              <button className="btn" disabled={busy !== null} onClick={() => void act('confirm', () => dmNotary({ v: 1, type: 'deal.confirm', dealId }))}>
                {busy === 'confirm' ? <span className="spinner" /> : 'Confirm delivery ✓'}
              </button>
              <button className="btn danger" disabled={busy !== null} onClick={() => setShowDispute(true)}>Dispute…</button>
            </div>
          ) : (
            <div>
              <label className="field">
                <span>What went wrong?</span>
                <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="Not as described because…" />
              </label>
              <div className="row">
                <button
                  className="btn danger"
                  disabled={busy !== null}
                  onClick={() => void act('dispute', () => dmNotary({ v: 1, type: 'deal.dispute', dealId, reason: disputeReason.trim() || undefined }))}
                >
                  {busy === 'dispute' ? <span className="spinner" /> : 'File dispute'}
                </button>
                <button className="btn secondary" onClick={() => setShowDispute(false)}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* proof display */}
      {snap && 'proof' in snap === false ? null : null}

      {/* event timeline */}
      <div className="card">
        <h2>Event trail</h2>
        {events.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i}>
                <span className="t">{when(e.at)}</span>
                <b>{e.event}</b>
                {e.detail && <span className="muted"> — {e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        {snap?.settlement?.transferIds && snap.settlement.transferIds.length > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            Settlement transfer id(s): <code>{snap.settlement.transferIds.join(', ')}</code>
          </p>
        )}
      </div>
    </div>
  );
}
