import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HAPPY_PATH, type DealState } from '@notary/shared';
import { fetchDealTrail } from '../lib/api.js';
import { SearchIcon, CheckIcon, ClockIcon } from '../components/Icon.js';
import { PageLayout, AsideCard } from '../components/PageLayout.js';
import { human, timeLeft, when } from '../lib/format.js';
import { dmNotary } from '../lib/notary.js';
import { humanError } from '../lib/sphere.js';
import { useConnect } from '../state/ConnectContext.js';
import { useMeta } from '../lib/meta.js';

const TERMINAL_LABEL: Partial<Record<string, string>> = {
  RELEASED: 'Released to seller',
  REFUNDED: 'Refunded to buyer',
  RESOLVED: 'Resolved by arbitration',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired unfunded',
};

export function DealDetail() {
  const { dealId = '' } = useParams();
  const { deals, nametag, fundEscrow, refreshDeals } = useConnect();
  const qc = useQueryClient();
  const stored = deals[dealId];
  const shortId = dealId ? dealId.slice(0, 8) : '';
  const metaSnap = stored?.snapshot;
  useMeta({
    title: dealId ? `Deal ${shortId}` : 'Deal',
    description: metaSnap
      ? `Escrow deal ${shortId} on Notary — ${human(metaSnap.amount)} ${metaSnap.symbol ?? ''} between @${metaSnap.buyerTag} and @${metaSnap.sellerTag}, currently ${metaSnap.state}.`.replace(/\s+/g, ' ').trim()
      : 'Follow a Notary escrow deal end to end — funding, delivery, settlement and any dispute, all settled by the autonomous @notary agent.',
  });
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
  const [evidence, setEvidence] = useState('');
  const [evidenceProof, setEvidenceProof] = useState('');
  // Optimistic overlay: the notary agent settles a signed action asynchronously
  // (it detects the transfer / reads the DM, then emits deal.update). Until that
  // lands we show the expected next state so the just-clicked button doesn't linger.
  const [optimistic, setOptimistic] = useState<{ from: DealState; to: DealState } | null>(null);
  const syncTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const snap = stored?.snapshot;
  // Merge: DM snapshot is richer; the public API trail keeps us honest if DMs lag.
  const realState = (snap?.state ?? trail?.state ?? 'PROPOSED') as DealState;
  // Show the optimistic target only while reality still sits on the pre-action state.
  const state = optimistic && realState === optimistic.from ? optimistic.to : realState;

  // Once the agent's update advances (or diverges from) the pre-action state, drop the overlay.
  useEffect(() => {
    if (optimistic && realState !== optimistic.from) setOptimistic(null);
  }, [realState, optimistic]);

  // Burst-poll the DM/trail after a signed action so the agent's deal.update is
  // picked up within ~2s instead of waiting on the 8s background poll.
  const startSync = useCallback(() => {
    if (syncTimer.current) clearInterval(syncTimer.current);
    const pull = () => {
      void refreshDeals();
      void qc.invalidateQueries({ queryKey: ['trail', dealId] });
    };
    pull();
    let tries = 0;
    syncTimer.current = setInterval(() => {
      pull();
      if (++tries >= 15 && syncTimer.current) {
        clearInterval(syncTimer.current);
        syncTimer.current = null;
        // Reality never advanced — stop lying and let the background poll reconcile.
        setOptimistic(null);
      }
    }, 2000);
  }, [refreshDeals, qc, dealId]);

  useEffect(() => () => {
    if (syncTimer.current) clearInterval(syncTimer.current);
  }, []);

  const isBuyer = snap?.buyerTag?.toLowerCase() === nametag?.toLowerCase();
  const isSeller = snap?.sellerTag?.toLowerCase() === nametag?.toLowerCase();

  const act = async (label: string, expected: DealState | null, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      if (expected) setOptimistic({ from: realState, to: expected });
      startSync();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!snap && !trail) {
    return <div className="empty"><div className="big"><SearchIcon size={40} /></div>Deal {dealId} isn't known to this browser yet.</div>;
  }

  const path: DealState[] = [...HAPPY_PATH];
  const stepIndex =
    state === 'RELEASED' ? path.length - 1 :
    state === 'REFUNDED' || state === 'CANCELLED' || state === 'EXPIRED' || state === 'RESOLVED' ? -1 :
    state === 'DISPUTED' || state === 'RELEASE_PENDING' ? path.indexOf('DELIVERED_CLAIMED') : // stays on the delivery step
    path.indexOf(state);

  const events = (snap?.events ?? trail?.events ?? []) as { at: number; event: string; detail?: string }[];

  const role = isBuyer ? 'buyer' : isSeller ? 'seller' : null;
  const amount = snap?.amount ?? trail?.amount ?? '0';
  const symbol = snap?.symbol ?? trail?.symbol ?? '';
  const feePct = (snap?.feeBps ?? trail?.feeBps ?? 100) / 100;
  const deadline = snap?.deadlineAt ?? trail?.deadlineAt ?? null;
  const showDeadline = deadline && state !== 'RELEASED' && state !== 'REFUNDED' && state !== 'RESOLVED';

  const aside = (
    <AsideCard title="Deal summary">
      <div className="aside-kv">
        {role && (
          <div className="kv"><span className="k">Your role</span><span className="v"><span className="badge">{role}</span></span></div>
        )}
        {snap?.buyerTag && <div className="kv"><span className="k">Buyer</span><span className="v">@{snap.buyerTag}</span></div>}
        {snap?.sellerTag && <div className="kv"><span className="k">Seller</span><span className="v">@{snap.sellerTag}</span></div>}
        <div className="kv"><span className="k">Amount</span><span className="v gold">{human(amount)} {symbol}</span></div>
        <div className="kv"><span className="k">Notary fee</span><span className="v">{feePct}%</span></div>
        {showDeadline && (
          <div className="kv">
            <span className="k">Time left</span>
            <span className="v"><ClockIcon size={13} className="inline-ico" /> {timeLeft(deadline)}</span>
          </div>
        )}
      </div>
    </AsideCard>
  );

  return (
    <PageLayout aside={aside}>
      <div className="spread">
        <h1 className="mono deal-id">{dealId}</h1>
        <span className={`badge lg ${state}`}>{state.replace(/_/g, ' ')}</span>
      </div>
      <p className="sub mb-lg">{snap?.deliverable}</p>

      {/* stepper */}
      {stepIndex >= 0 ? (
        <div className="stepper">
          {path.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <span className="step-line" />}
              <span className={`step ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}`}>
                <span className="dot">{i < stepIndex ? <CheckIcon size={13} /> : i + 1}</span>
                <span className="lbl">{s.replace(/_/g, ' ')}</span>
              </span>
            </Fragment>
          ))}
        </div>
      ) : (
        <div className={`card terminal-card${state === 'REFUNDED' || state === 'RESOLVED' ? ' refunded' : ''}`}>
          <b>{TERMINAL_LABEL[state] ?? state}</b>
          {snap?.settlement && (
            <div className="muted mt-sm">
              {snap.settlement.toBuyer && snap.settlement.toBuyer !== '0' && <>↩ {human(snap.settlement.toBuyer)} to @{snap.buyerTag} · </>}
              {snap.settlement.toSeller && snap.settlement.toSeller !== '0' && <>→ {human(snap.settlement.toSeller)} to @{snap.sellerTag} · </>}
              {snap.settlement.fee && <>fee retained {human(snap.settlement.fee)}</>}
            </div>
          )}
          {snap?.dispute?.verdict && (
            <div className="mt-sm">
              <div className="muted"><b>Arbiter:</b> {snap.dispute.verdict.arbiter} · awarded buyer {(snap.dispute.verdict.buyerBps / 100).toFixed(0)}%</div>
              {snap.dispute.verdict.rationale && <p className="mt-sm">“{snap.dispute.verdict.rationale}”</p>}
            </div>
          )}
        </div>
      )}

      {/* fund escrow card - the star of the buyer flow */}
      {state === 'AWAITING_FUNDS' && isBuyer && snap && (
        <div className="pay-card">
          <h2>Fund escrow - pay {human(snap.amount)} {snap.symbol ?? ''}</h2>
          <p className="muted">
            Your wallet transfers the escrow amount to @notary, tagged with this deal id. Funds stay with the
            notary until delivery is confirmed, disputed, or timed out - the agent settles on its own either way.
            Don't fund and the deal simply expires.
          </p>
          {err && <p className="error-text">{err}</p>}
          <div className="row">
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => void act('pay', 'FUNDED', () =>
                fundEscrow({ dealId, amount: snap.amount, coinId: snap.coinId, symbol: snap.symbol }),
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
            <button className="btn" disabled={busy !== null} onClick={() => void act('accept', 'AWAITING_FUNDS', () => dmNotary({ v: 1, type: 'deal.accept', dealId }))}>
              {busy === 'accept' ? <span className="spinner" /> : 'Accept deal'}
            </button>
            <button className="btn danger" disabled={busy !== null} onClick={() => void act('reject', 'CANCELLED', () => dmNotary({ v: 1, type: 'deal.reject', dealId }))}>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* seller: mark delivered */}
      {state === 'FUNDED' && isSeller && (
        <div className="card">
          <h2>Escrow is funded - deliver the goods</h2>
          <label className="field">
            <span>Proof of delivery (optional URL or hash)</span>
            <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://…" />
          </label>
          {err && <p className="error-text">{err}</p>}
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => void act('delivered', 'DELIVERED_CLAIMED', () => dmNotary({ v: 1, type: 'deal.delivered', dealId, proof: proof.trim() || undefined }))}
          >
            {busy === 'delivered' ? <span className="spinner" /> : 'Mark as delivered'}
          </button>
        </div>
      )}

      {/* milestone progress — staged deals */}
      {snap?.milestones && snap.milestones.length > 1 && (
        <div className="card">
          <h2>Milestones</h2>
          <p className="muted">
            {(snap.currentMilestone ?? 0) + 1} of {snap.milestones.length} · staged escrow of {human(snap.totalAmount ?? snap.amount)}{' '}
            {snap.symbol ?? ''} total. Each is funded and released in turn; only the active one is ever at risk.
          </p>
          <ul className="milestone-list">
            {snap.milestones.map((mm) => {
              const active = mm.index === (snap.currentMilestone ?? -1) && !['RELEASED', 'REFUNDED', 'RESOLVED'].includes(state);
              return (
                <li key={mm.index} className={`milestone-item ${mm.state}${active ? ' active' : ''}`}>
                  <span className={`badge ${mm.state === 'released' ? 'RELEASED' : mm.state === 'refunded' || mm.state === 'resolved' ? 'REFUNDED' : active ? 'FUNDED' : ''}`}>
                    {active ? 'active' : mm.state}
                  </span>
                  <span className="milestone-amt gold">{human(mm.amount)} {snap.symbol ?? ''}</span>
                  <span className="muted milestone-desc">{mm.deliverable}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* buyer: confirm / dispute (also during the RELEASE_PENDING appeal window) */}
      {(state === 'DELIVERED_CLAIMED' || state === 'RELEASE_PENDING') && isBuyer && (
        <div className="card">
          {state === 'RELEASE_PENDING' && (
            <div className="terminal-card refunded" style={{ marginBottom: '0.9rem' }}>
              <b>⏳ About to auto-release</b>
              <div className="muted mt-sm">
                Your confirm window lapsed, so the escrow is scheduled to release to the seller{deadline ? ` ${timeLeft(deadline)}` : ' soon'}.
                This is your last chance to reject the delivery — dispute now if it wasn't as agreed.
              </div>
            </div>
          )}
          <h2>The seller says it's delivered</h2>
          <p className="muted">
            Confirm to release {human(snap?.amount ?? '0')} {snap?.symbol ?? ''} (minus fee) to @{snap?.sellerTag}. Silence past
            the deadline counts as acceptance. Disputing opens an evidence-based arbitration: both sides submit
            evidence and an AI arbiter rules a fair split of the escrow.
          </p>
          {err && <p className="error-text">{err}</p>}
          {!showDispute ? (
            <div className="row">
              <button className="btn" disabled={busy !== null} onClick={() => void act('confirm', 'RELEASED', () => dmNotary({ v: 1, type: 'deal.confirm', dealId }))}>
                {busy === 'confirm' ? <span className="spinner" /> : <span className="btn-ico">Confirm delivery <CheckIcon size={16} /></span>}
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
                  onClick={() => void act('dispute', 'DISPUTED', () => dmNotary({ v: 1, type: 'deal.dispute', dealId, reason: disputeReason.trim() || undefined }))}
                >
                  {busy === 'dispute' ? <span className="spinner" /> : 'File dispute'}
                </button>
                <button className="btn secondary" onClick={() => setShowDispute(false)}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* arbitration: both parties submit evidence while DISPUTED */}
      {state === 'DISPUTED' && (
        <div className="card terminal-card refunded">
          <h2>In arbitration</h2>
          <p className="muted">
            This deal is disputed. Both parties may submit evidence; an AI arbiter then reads the deliverable and
            all evidence and rules a split of the escrow, minus the arbitration fee. The arbiter also rules
            automatically when the evidence window closes.
          </p>
          {snap?.dispute?.buyerEvidence && (
            <p className="mt-sm"><b>Buyer:</b> <span className="muted">{snap.dispute.buyerEvidence}</span></p>
          )}
          {snap?.dispute?.sellerEvidence && (
            <p className="mt-sm"><b>Seller:</b> <span className="muted">{snap.dispute.sellerEvidence}</span></p>
          )}
          {role ? (
            <div className="mt-md">
              <label className="field">
                <span>Your evidence</span>
                <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Describe what happened, with any links or references…" />
              </label>
              <label className="field">
                <span>Proof (optional URL or hash)</span>
                <input value={evidenceProof} onChange={(e) => setEvidenceProof(e.target.value)} placeholder="https://…" />
              </label>
              {err && <p className="error-text">{err}</p>}
              <button
                className="btn"
                disabled={busy !== null || evidence.trim().length === 0}
                onClick={() => void act('evidence', null, async () => {
                  await dmNotary({ v: 1, type: 'deal.evidence', dealId, statement: evidence.trim(), proof: evidenceProof.trim() || undefined });
                  setEvidence('');
                  setEvidenceProof('');
                })}
              >
                {busy === 'evidence' ? <span className="spinner" /> : 'Submit evidence'}
              </button>
            </div>
          ) : (
            <p className="muted mt-sm">Only the buyer or seller can submit evidence.</p>
          )}
        </div>
      )}

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
                {e.detail && <span className="muted"> - {e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        {snap?.settlement?.transferIds && snap.settlement.transferIds.length > 0 && (
          <p className="muted mt-md">
            Settlement transfer id(s): <code>{snap.settlement.transferIds.join(', ')}</code>
          </p>
        )}
      </div>
    </PageLayout>
  );
}
