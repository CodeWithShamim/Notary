import { describe, expect, it } from 'vitest';
import { DealEvent, DealState, DEAL_STATES } from '@notary/shared';
import type { DealRow } from './db.js';
import { TIMEOUT_EVENT_FOR_STATE, transition, type MachineConfig } from './machine.js';

const cfg: MachineConfig = {
  disputeFeeBps: 50,
  fundingTimeoutMs: 24 * 3_600_000,
  confirmTimeoutMs: 48 * 3_600_000,
  disputeWindowMs: 24 * 3_600_000,
  appealWindowMs: 24 * 3_600_000,
};

const NOW = 1_750_000_000_000;

function deal(state: DealState, extra: Partial<DealRow> = {}): DealRow {
  return {
    dealId: 'deal_test01',
    state,
    buyerPubkey: 'buyerpub',
    buyerTag: 'alice',
    sellerPubkey: 'sellerpub',
    sellerTag: 'bob',
    amount: '1000000',
    coinId: 'coinhex',
    symbol: 'UCT',
    feeBps: 100,
    deliverable: 'a logo',
    deliveryHours: 72,
    proof: null,
    paymentRequestId: null,
    fundedTransferId: null,
    settlementJson: null,
    buyerEvidence: null,
    sellerEvidence: null,
    verdictJson: null,
    buyerProposalBps: null,
    sellerProposalBps: null,
    milestonesJson: null,
    currentMilestone: null,
    totalAmount: '1000000',
    createdAt: NOW - 1000,
    deadlineAt: NOW + 1000,
    updatedAt: NOW - 1000,
    ...extra,
  };
}

/** A staged (milestone) deal in the given active-milestone state. `plan` lists the
 *  milestone amounts; `current` is the active index. The active leg fields mirror it. */
function milestoneDeal(
  state: DealState,
  amounts: string[],
  current: number,
  extra: Partial<DealRow> = {},
): DealRow {
  const plan = amounts.map((amount, index) => ({
    index,
    amount,
    deliverable: `stage ${index + 1}`,
    deliveryHours: 72,
    state: (index < current ? 'released' : index === current ? 'active' : 'pending') as
      | 'pending'
      | 'active'
      | 'released'
      | 'refunded'
      | 'resolved',
  }));
  const total = amounts.reduce((s, a) => s + BigInt(a), 0n).toString();
  return deal(state, {
    amount: amounts[current],
    deliverable: `stage ${current + 1}`,
    milestonesJson: JSON.stringify(plan),
    currentMilestone: current,
    totalAmount: total,
    ...extra,
  });
}

function assertOk(r: ReturnType<typeof transition>) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error} (${r.from} + ${r.event})`);
  return r;
}

describe('transition — happy path', () => {
  it('PROPOSED + ACCEPT → AWAITING_FUNDS, sends payment request, sets funding timer, learns seller pubkey', () => {
    const r = assertOk(transition(deal(DealState.PROPOSED, { sellerPubkey: null }), DealEvent.ACCEPT, { sellerPubkey: 'newpub' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.AWAITING_FUNDS);
    expect(r.deal.sellerPubkey).toBe('newpub');
    expect(r.deal.deadlineAt).toBe(NOW + cfg.fundingTimeoutMs);
    expect(r.effects.map((e) => e.type)).toEqual(['send_payment_request', 'notify']);
  });

  it('AWAITING_FUNDS + FUNDS_RECEIVED → FUNDED, delivery timer from deal terms, records transferId', () => {
    const r = assertOk(transition(deal(DealState.AWAITING_FUNDS), DealEvent.FUNDS_RECEIVED, { transferId: 'tx1' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.FUNDED);
    expect(r.deal.fundedTransferId).toBe('tx1');
    expect(r.deal.deadlineAt).toBe(NOW + 72 * 3_600_000);
    expect(r.effects).toEqual([expect.objectContaining({ type: 'notify', audience: 'both' })]);
  });

  it('FUNDED + DELIVERED → DELIVERED_CLAIMED, confirm timer, stores proof', () => {
    const r = assertOk(transition(deal(DealState.FUNDED), DealEvent.DELIVERED, { proof: 'https://x' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.DELIVERED_CLAIMED);
    expect(r.deal.proof).toBe('https://x');
    expect(r.deal.deadlineAt).toBe(NOW + cfg.confirmTimeoutMs);
  });

  it('DELIVERED_CLAIMED + CONFIRM → RELEASED, pays seller amount minus 1% fee', () => {
    const r = assertOk(transition(deal(DealState.DELIVERED_CLAIMED), DealEvent.CONFIRM, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RELEASED);
    expect(r.deal.deadlineAt).toBeNull();
    const payout = r.effects.find((e) => e.type === 'payout');
    expect(payout).toMatchObject({ kind: 'release', recipient: 'seller', amount: 990_000n });
    expect(JSON.parse(r.deal.settlementJson!)).toEqual({ toSeller: '990000', fee: '10000' });
  });
});

describe('transition — refund / cancel paths', () => {
  it('PROPOSED + REJECT → CANCELLED, no payout', () => {
    const r = assertOk(transition(deal(DealState.PROPOSED), DealEvent.REJECT, { reason: 'too cheap' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.CANCELLED);
    expect(r.effects.every((e) => e.type !== 'payout')).toBe(true);
  });

  it('PROPOSED + ACCEPT_TIMEOUT → CANCELLED', () => {
    const r = assertOk(transition(deal(DealState.PROPOSED), DealEvent.ACCEPT_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.CANCELLED);
  });

  it('AWAITING_FUNDS + FUNDING_TIMEOUT → EXPIRED, no payout (nothing escrowed)', () => {
    const r = assertOk(transition(deal(DealState.AWAITING_FUNDS), DealEvent.FUNDING_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.EXPIRED);
    expect(r.effects.every((e) => e.type !== 'payout')).toBe(true);
  });

  it('FUNDED + DELIVERY_TIMEOUT → REFUNDED, buyer refunded IN FULL', () => {
    const r = assertOk(transition(deal(DealState.FUNDED), DealEvent.DELIVERY_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.REFUNDED);
    const payout = r.effects.find((e) => e.type === 'payout');
    expect(payout).toMatchObject({ kind: 'refund', recipient: 'buyer', amount: 1_000_000n });
  });

  it('DELIVERED_CLAIMED + DISPUTE → DISPUTED, opens evidence window, no payout yet', () => {
    const r = assertOk(transition(deal(DealState.DELIVERED_CLAIMED), DealEvent.DISPUTE, { reason: 'not as described' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.DISPUTED);
    expect(r.deal.buyerEvidence).toBe('not as described');
    expect(r.deal.deadlineAt).toBe(NOW + cfg.disputeWindowMs);
    expect(r.effects.every((e) => e.type !== 'payout')).toBe(true);
    expect(r.deal.settlementJson).toBeNull();
  });

  it('DISPUTED + RESOLVE (full buyer award) → RESOLVED, buyer refunded minus arbitration fee', () => {
    const r = assertOk(transition(deal(DealState.DISPUTED), DealEvent.RESOLVE, { buyerBps: 10_000, rationale: 'seller never delivered', arbiter: 'claude-opus-4-8' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RESOLVED);
    const payouts = r.effects.filter((e) => e.type === 'payout');
    // fee = 1_000_000 * 50 / 10000 = 5000; remainder 995000 all to buyer
    expect(payouts).toEqual([expect.objectContaining({ kind: 'arbitration', recipient: 'buyer', amount: 995_000n })]);
    expect(JSON.parse(r.deal.settlementJson!)).toEqual({ toBuyer: '995000', toSeller: '0', fee: '5000' });
    expect(JSON.parse(r.deal.verdictJson!)).toMatchObject({ buyerBps: 10_000, arbiter: 'claude-opus-4-8' });
  });

  it('DISPUTED + RESOLVE (60/40 split) → RESOLVED, pays both parties, sum exact', () => {
    const r = assertOk(transition(deal(DealState.DISPUTED), DealEvent.RESOLVE, { buyerBps: 6_000 }, NOW, cfg));
    const payouts = r.effects.filter((e) => e.type === 'payout') as { recipient: string; amount: bigint }[];
    const toBuyer = payouts.find((p) => p.recipient === 'buyer')!.amount;
    const toSeller = payouts.find((p) => p.recipient === 'seller')!.amount;
    // remainder 995000: buyer 60% floored = 597000, seller gets the rest 398000
    expect(toBuyer).toBe(597_000n);
    expect(toSeller).toBe(398_000n);
    expect(toBuyer + toSeller + 5_000n).toBe(1_000_000n); // no dust lost
  });

  it('DELIVERED_CLAIMED + CONFIRM_TIMEOUT → RELEASE_PENDING (appeal window, NO payout yet)', () => {
    const r = assertOk(transition(deal(DealState.DELIVERED_CLAIMED), DealEvent.CONFIRM_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RELEASE_PENDING);
    expect(r.deal.deadlineAt).toBe(NOW + cfg.appealWindowMs);
    expect(r.effects.every((e) => e.type !== 'payout')).toBe(true);
    expect(r.deal.settlementJson).toBeNull();
    // The buyer gets a final warning so a sleeping buyer can still reject.
    expect(r.effects).toEqual([expect.objectContaining({ type: 'notify', audience: 'buyer' })]);
  });
});

describe('transition — appeal window (feature 5)', () => {
  it('RELEASE_PENDING + APPEAL_TIMEOUT → RELEASED, pays seller minus fee', () => {
    const r = assertOk(transition(deal(DealState.RELEASE_PENDING), DealEvent.APPEAL_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RELEASED);
    expect(r.deal.deadlineAt).toBeNull();
    const payout = r.effects.find((e) => e.type === 'payout');
    expect(payout).toMatchObject({ kind: 'release', recipient: 'seller', amount: 990_000n });
  });

  it('RELEASE_PENDING + CONFIRM → RELEASED (buyer woke up and confirmed)', () => {
    const r = assertOk(transition(deal(DealState.RELEASE_PENDING), DealEvent.CONFIRM, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RELEASED);
    expect(r.effects.find((e) => e.type === 'payout')).toMatchObject({ kind: 'release', recipient: 'seller' });
  });

  it('RELEASE_PENDING + DISPUTE → DISPUTED (buyer rejects during the grace window)', () => {
    const r = assertOk(transition(deal(DealState.RELEASE_PENDING), DealEvent.DISPUTE, { reason: 'it was junk' }, NOW, cfg));
    expect(r.deal.state).toBe(DealState.DISPUTED);
    expect(r.deal.buyerEvidence).toBe('it was junk');
    expect(r.deal.deadlineAt).toBe(NOW + cfg.disputeWindowMs);
    expect(r.effects.every((e) => e.type !== 'payout')).toBe(true);
  });
});

describe('transition — staged (milestone) escrow (feature 3)', () => {
  it('releasing a non-final milestone advances to AWAITING_FUNDS, pays that milestone, requests the next', () => {
    // 3 stages of 300k / 400k / 300k; milestone 0 is DELIVERED_CLAIMED and gets confirmed.
    const d = milestoneDeal(DealState.DELIVERED_CLAIMED, ['300000', '400000', '300000'], 0);
    const r = assertOk(transition(d, DealEvent.CONFIRM, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.AWAITING_FUNDS); // NOT terminal — next milestone opens
    expect(r.deal.currentMilestone).toBe(1);
    expect(r.deal.amount).toBe('400000'); // active leg is now milestone 1
    expect(r.deal.deadlineAt).toBe(NOW + cfg.fundingTimeoutMs);
    // milestone 0 released 300000 * 0.99 = 297000 to seller; a new funding request is queued
    expect(r.effects.find((e) => e.type === 'payout')).toMatchObject({ kind: 'release', recipient: 'seller', amount: 297_000n });
    expect(r.effects.some((e) => e.type === 'send_payment_request')).toBe(true);
    const plan = JSON.parse(r.deal.milestonesJson!) as { state: string }[];
    expect(plan.map((p) => p.state)).toEqual(['released', 'active', 'pending']);
    expect(r.deal.settlementJson).toBeNull(); // deal-level settlement only set at final release
  });

  it('releasing the FINAL milestone terminates the deal as RELEASED', () => {
    const d = milestoneDeal(DealState.DELIVERED_CLAIMED, ['300000', '400000', '300000'], 2);
    const r = assertOk(transition(d, DealEvent.CONFIRM, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RELEASED);
    expect(r.deal.deadlineAt).toBeNull();
    expect(r.effects.some((e) => e.type === 'send_payment_request')).toBe(false);
    expect(r.effects.find((e) => e.type === 'payout')).toMatchObject({ kind: 'release', amount: 297_000n });
    expect(JSON.parse(r.deal.settlementJson!)).toEqual({ toSeller: '297000', fee: '3000' });
    const plan = JSON.parse(r.deal.milestonesJson!) as { state: string }[];
    expect(plan.map((p) => p.state)).toEqual(['released', 'released', 'released']);
  });

  it('the sum of every milestone release + fee equals the escrowed total, no dust', () => {
    const amounts = ['300000', '400000', '300001']; // total 1000001
    let toSeller = 0n;
    let fees = 0n;
    for (let i = 0; i < amounts.length; i++) {
      const d = milestoneDeal(DealState.DELIVERED_CLAIMED, amounts, i);
      const r = assertOk(transition(d, DealEvent.CONFIRM, {}, NOW, cfg));
      const payout = r.effects.find((e) => e.type === 'payout') as { amount: bigint };
      toSeller += payout.amount;
      fees += BigInt(amounts[i]!) - payout.amount;
    }
    expect(toSeller + fees).toBe(1_000_001n);
  });

  it('a milestone DELIVERY_TIMEOUT refunds only the active leg and terminates the deal', () => {
    const d = milestoneDeal(DealState.FUNDED, ['300000', '400000', '300000'], 1);
    const r = assertOk(transition(d, DealEvent.DELIVERY_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.REFUNDED); // whole deal ends; later milestones never funded
    expect(r.effects.find((e) => e.type === 'payout')).toMatchObject({ kind: 'refund', recipient: 'buyer', amount: 400_000n });
    const plan = JSON.parse(r.deal.milestonesJson!) as { state: string }[];
    expect(plan[1]!.state).toBe('refunded');
  });

  it('a milestone CONFIRM_TIMEOUT opens the appeal window on the active leg (no advance)', () => {
    const d = milestoneDeal(DealState.DELIVERED_CLAIMED, ['300000', '400000'], 0);
    const r = assertOk(transition(d, DealEvent.CONFIRM_TIMEOUT, {}, NOW, cfg));
    expect(r.deal.state).toBe(DealState.RELEASE_PENDING);
    expect(r.deal.currentMilestone).toBe(0); // unchanged — advance only happens on release
    expect(r.effects.every((e) => e.type !== 'payout')).toBe(true);
  });
});

describe('transition — illegal transitions are rejected, never throw', () => {
  const LEGAL: [DealState, DealEvent][] = [
    [DealState.PROPOSED, DealEvent.ACCEPT],
    [DealState.PROPOSED, DealEvent.REJECT],
    [DealState.PROPOSED, DealEvent.ACCEPT_TIMEOUT],
    [DealState.AWAITING_FUNDS, DealEvent.FUNDS_RECEIVED],
    [DealState.AWAITING_FUNDS, DealEvent.FUNDING_TIMEOUT],
    [DealState.FUNDED, DealEvent.DELIVERED],
    [DealState.FUNDED, DealEvent.DELIVERY_TIMEOUT],
    [DealState.DELIVERED_CLAIMED, DealEvent.CONFIRM],
    [DealState.DELIVERED_CLAIMED, DealEvent.DISPUTE],
    [DealState.DELIVERED_CLAIMED, DealEvent.CONFIRM_TIMEOUT],
    [DealState.RELEASE_PENDING, DealEvent.CONFIRM],
    [DealState.RELEASE_PENDING, DealEvent.DISPUTE],
    [DealState.RELEASE_PENDING, DealEvent.APPEAL_TIMEOUT],
    [DealState.DISPUTED, DealEvent.RESOLVE],
  ];

  it('every (state, event) pair outside the table returns ILLEGAL_TRANSITION', () => {
    for (const from of DEAL_STATES) {
      for (const event of Object.values(DealEvent)) {
        const isLegal = LEGAL.some(([s, e]) => s === from && e === event);
        const r = transition(deal(from), event, {}, NOW, cfg);
        expect(r.ok, `${from} + ${event}`).toBe(isLegal);
        if (!r.ok) expect(r).toMatchObject({ error: 'ILLEGAL_TRANSITION', from, event });
      }
    }
  });

  it('double-settlement is impossible: terminal states accept no events', () => {
    for (const from of [DealState.RELEASED, DealState.REFUNDED, DealState.RESOLVED, DealState.CANCELLED, DealState.EXPIRED]) {
      for (const event of Object.values(DealEvent)) {
        expect(transition(deal(from), event, {}, NOW, cfg).ok).toBe(false);
      }
    }
  });

  it('does not mutate the input deal', () => {
    const d = deal(DealState.DELIVERED_CLAIMED);
    const frozen = JSON.stringify(d);
    transition(d, DealEvent.CONFIRM, {}, NOW, cfg);
    expect(JSON.stringify(d)).toBe(frozen);
  });
});

describe('timeout mapping', () => {
  it('maps every non-terminal state to its timeout event', () => {
    expect(TIMEOUT_EVENT_FOR_STATE[DealState.PROPOSED]).toBe(DealEvent.ACCEPT_TIMEOUT);
    expect(TIMEOUT_EVENT_FOR_STATE[DealState.AWAITING_FUNDS]).toBe(DealEvent.FUNDING_TIMEOUT);
    expect(TIMEOUT_EVENT_FOR_STATE[DealState.FUNDED]).toBe(DealEvent.DELIVERY_TIMEOUT);
    expect(TIMEOUT_EVENT_FOR_STATE[DealState.DELIVERED_CLAIMED]).toBe(DealEvent.CONFIRM_TIMEOUT);
    expect(TIMEOUT_EVENT_FOR_STATE[DealState.RELEASE_PENDING]).toBe(DealEvent.APPEAL_TIMEOUT);
    expect(TIMEOUT_EVENT_FOR_STATE[DealState.RELEASED]).toBeUndefined();
  });
});
