/**
 * Pure deal state machine. No I/O, no SDK, no clock — everything injected.
 * Returns the mutated-copy deal row plus a list of effects for the runtime
 * (dealService) to execute. Illegal transitions return an error, never throw.
 */
import {
  DealEvent,
  DealState,
  arbitrationSplit,
  nextState,
  releaseSplit,
} from '@notary/shared';
import type { DealRow } from './db.js';

export interface MachineConfig {
  disputeFeeBps: number;
  fundingTimeoutMs: number;
  confirmTimeoutMs: number;
  disputeWindowMs: number;
  appealWindowMs: number;
}

/** One stage of a staged (milestone) deal, as persisted in DealRow.milestonesJson. */
export interface MilestonePlanEntry {
  index: number;
  amount: string; //   base units
  deliverable: string;
  deliveryHours: number;
  state: 'pending' | 'active' | 'released' | 'refunded' | 'resolved';
  settlement?: { toSeller?: string; toBuyer?: string; fee?: string };
}

/** True for a staged deal (has a persisted milestone plan). */
function isMilestoneDeal(d: DealRow): boolean {
  return d.milestonesJson !== null && d.currentMilestone !== null;
}

function parsePlan(d: DealRow): MilestonePlanEntry[] {
  return d.milestonesJson ? (JSON.parse(d.milestonesJson) as MilestonePlanEntry[]) : [];
}

/** Record the active milestone's terminal state (refund/dispute outcome) in the
 *  plan so the snapshot reflects it. No-op for single deals. */
function markActiveMilestone(
  d: DealRow,
  state: MilestonePlanEntry['state'],
  settlement?: MilestonePlanEntry['settlement'],
): void {
  if (!isMilestoneDeal(d)) return;
  const plan = parsePlan(d);
  const i = d.currentMilestone!;
  if (plan[i]) {
    plan[i].state = state;
    if (settlement) plan[i].settlement = settlement;
    d.milestonesJson = JSON.stringify(plan);
  }
}

/**
 * On a clean release of the active milestone, mark it settled in the plan and,
 * if more milestones remain, re-open funding for the next one (mutating `d` and
 * pushing a payment-request effect). Returns true when it advanced to a next
 * milestone, false for a single deal or the final milestone (caller finalizes
 * the terminal RELEASED settlement in that case).
 *
 * Money-safety invariant: only ONE milestone is ever funded at a time, so
 * advancing never leaves stale escrow, and every non-clean outcome (refund /
 * dispute / funding-expire) terminates the whole deal upstream.
 */
function advanceMilestoneOnRelease(
  d: DealRow,
  split: { toSeller: bigint; fee: bigint },
  now: number,
  cfg: MachineConfig,
  effects: Effect[],
): boolean {
  if (!isMilestoneDeal(d)) return false;
  const plan = parsePlan(d);
  const released = d.currentMilestone!;
  if (plan[released]) {
    plan[released].state = 'released';
    plan[released].settlement = { toSeller: split.toSeller.toString(), fee: split.fee.toString() };
  }

  const next = released + 1;
  if (next >= plan.length) {
    d.milestonesJson = JSON.stringify(plan); // all milestones settled; caller sets terminal RELEASED
    return false;
  }

  // Re-open funding for the next milestone. `to` was RELEASED from nextState — override it.
  const nextMs = plan[next]!;
  d.state = DealState.AWAITING_FUNDS;
  d.currentMilestone = next;
  nextMs.state = 'active';
  d.milestonesJson = JSON.stringify(plan);
  d.amount = nextMs.amount;
  d.deliverable = nextMs.deliverable;
  d.deliveryHours = nextMs.deliveryHours;
  d.proof = null;
  d.settlementJson = null;
  d.paymentRequestId = null;
  d.fundedTransferId = null;
  d.deadlineAt = now + cfg.fundingTimeoutMs;
  effects.push({ type: 'send_payment_request' });
  return true;
}

export type EventPayload = {
  sellerPubkey?: string; // ACCEPT — learn the seller's transport pubkey
  reason?: string; //       REJECT / DISPUTE
  proof?: string; //        DELIVERED
  transferId?: string; //   FUNDS_RECEIVED
  buyerBps?: number; //     RESOLVE — arbiter's award to the buyer (0..10000)
  rationale?: string; //    RESOLVE — arbiter's stated reasoning
  arbiter?: string; //      RESOLVE — which arbiter ruled (model id / "rule:default")
};

export type Effect =
  | { type: 'send_payment_request' } //  buyer funds escrow (on ACCEPT)
  | {
      type: 'payout';
      kind: 'release' | 'refund' | 'dispute_refund' | 'arbitration';
      recipient: 'buyer' | 'seller';
      amount: bigint;
      memo: string;
    }
  | { type: 'notify'; audience: 'buyer' | 'seller' | 'both'; text: string };

export type TransitionResult =
  | { ok: true; deal: DealRow; effects: Effect[] }
  | { ok: false; error: 'ILLEGAL_TRANSITION'; from: DealState; event: DealEvent };

/** Which timeout event fires when a state's deadline lapses. */
export const TIMEOUT_EVENT_FOR_STATE: Partial<Record<DealState, DealEvent>> = {
  [DealState.PROPOSED]: DealEvent.ACCEPT_TIMEOUT,
  [DealState.AWAITING_FUNDS]: DealEvent.FUNDING_TIMEOUT,
  [DealState.FUNDED]: DealEvent.DELIVERY_TIMEOUT,
  [DealState.DELIVERED_CLAIMED]: DealEvent.CONFIRM_TIMEOUT,
  [DealState.RELEASE_PENDING]: DealEvent.APPEAL_TIMEOUT,
};

export function transition(
  deal: DealRow,
  event: DealEvent,
  payload: EventPayload,
  now: number,
  cfg: MachineConfig,
): TransitionResult {
  const to = nextState(deal.state, event);
  if (to === null) {
    return { ok: false, error: 'ILLEGAL_TRANSITION', from: deal.state, event };
  }

  const d: DealRow = { ...deal, state: to, updatedAt: now, deadlineAt: null };
  const effects: Effect[] = [];
  const amount = BigInt(d.amount);

  switch (event) {
    case DealEvent.ACCEPT: {
      if (payload.sellerPubkey) d.sellerPubkey = payload.sellerPubkey;
      d.deadlineAt = now + cfg.fundingTimeoutMs;
      effects.push(
        { type: 'send_payment_request' },
        {
          type: 'notify',
          audience: 'buyer',
          text: `Seller @${d.sellerTag} accepted deal ${d.dealId}. Pay the escrow payment request to fund it.`,
        },
      );
      break;
    }
    case DealEvent.REJECT: {
      effects.push({
        type: 'notify',
        audience: 'both',
        text: `Deal ${d.dealId} cancelled: seller rejected${payload.reason ? ` — ${payload.reason}` : ''}.`,
      });
      break;
    }
    case DealEvent.ACCEPT_TIMEOUT: {
      effects.push({
        type: 'notify',
        audience: 'both',
        text: `Deal ${d.dealId} cancelled: seller did not accept in time.`,
      });
      break;
    }
    case DealEvent.FUNDS_RECEIVED: {
      if (payload.transferId) d.fundedTransferId = payload.transferId;
      d.deadlineAt = now + d.deliveryHours * 3_600_000;
      effects.push({
        type: 'notify',
        audience: 'both',
        text: `Deal ${d.dealId} is FUNDED (${d.amount} base units in escrow). Seller has ${d.deliveryHours}h to deliver.`,
      });
      break;
    }
    case DealEvent.FUNDING_TIMEOUT: {
      effects.push({
        type: 'notify',
        audience: 'both',
        text: `Deal ${d.dealId} expired: buyer did not fund in time. Nothing was escrowed.`,
      });
      break;
    }
    case DealEvent.DELIVERED: {
      if (payload.proof) d.proof = payload.proof;
      d.deadlineAt = now + cfg.confirmTimeoutMs;
      effects.push({
        type: 'notify',
        audience: 'buyer',
        text: `Seller claims delivery on deal ${d.dealId}${payload.proof ? ` (proof: ${payload.proof})` : ''}. Confirm or dispute within ${Math.round(cfg.confirmTimeoutMs / 3_600_000)}h — silence releases funds to the seller.`,
      });
      break;
    }
    case DealEvent.DELIVERY_TIMEOUT: {
      d.settlementJson = JSON.stringify({ toBuyer: amount.toString(), fee: '0' });
      markActiveMilestone(d, 'refunded', { toBuyer: amount.toString(), fee: '0' });
      const scope = isMilestoneDeal(d)
        ? `milestone ${d.currentMilestone! + 1} of deal ${d.dealId} (deal ends here — later milestones were never funded)`
        : `deal ${d.dealId}`;
      effects.push(
        {
          type: 'payout',
          kind: 'refund',
          recipient: 'buyer',
          amount,
          memo: `notary refund deal ${d.dealId} (delivery timeout)`,
        },
        {
          type: 'notify',
          audience: 'both',
          text: `${scope}: seller missed the delivery window. Buyer refunded in full (${amount} base units).`,
        },
      );
      break;
    }
    case DealEvent.CONFIRM_TIMEOUT: {
      // Silence no longer releases instantly. Open a short appeal window with a
      // final warning so a buyer who was simply asleep can still dispute/confirm
      // before the escrow leaves for the seller.
      d.deadlineAt = now + cfg.appealWindowMs;
      const hrs = Math.max(1, Math.round(cfg.appealWindowMs / 3_600_000));
      const scope = isMilestoneDeal(d) ? `milestone ${d.currentMilestone! + 1} of deal ${d.dealId}` : `deal ${d.dealId}`;
      effects.push({
        type: 'notify',
        audience: 'buyer',
        text: `Your confirmation window on ${scope} lapsed. The escrow (${d.amount} base units) will auto-release to the seller in ${hrs}h unless you confirm or DISPUTE now. This is your last chance to reject the delivery.`,
      });
      break;
    }
    case DealEvent.CONFIRM:
    case DealEvent.APPEAL_TIMEOUT: {
      const { toSeller, fee } = releaseSplit(amount, d.feeBps);
      const why = event === DealEvent.CONFIRM ? 'buyer confirmed delivery' : 'appeal window lapsed (silence = acceptance)';
      effects.push({
        type: 'payout',
        kind: 'release',
        recipient: 'seller',
        amount: toSeller,
        memo: `notary release deal ${d.dealId}`,
      });
      // Staged deal with more milestones? Record this one settled and re-open funding
      // for the next; otherwise this is the final release (terminal RELEASED).
      const advanced = advanceMilestoneOnRelease(d, { toSeller, fee }, now, cfg, effects);
      if (advanced) {
        effects.push({
          type: 'notify',
          audience: 'both',
          text: `Deal ${d.dealId}: milestone ${d.currentMilestone!} released (${toSeller} to seller, ${fee} fee). Milestone ${d.currentMilestone! + 1} of ${parsePlan(d).length} is next — buyer, please fund it.`,
        });
      } else {
        d.settlementJson = JSON.stringify({ toSeller: toSeller.toString(), fee: fee.toString() });
        effects.push({
          type: 'notify',
          audience: 'both',
          text: `Deal ${d.dealId} RELEASED (${why}): ${toSeller} to seller, ${fee} retained as the notary fee.`,
        });
      }
      break;
    }
    case DealEvent.DISPUTE: {
      // No payout yet — open an evidence window; the arbiter rules when it lapses
      // (or as soon as both parties have submitted).
      if (payload.reason) d.buyerEvidence = payload.reason;
      d.deadlineAt = now + cfg.disputeWindowMs;
      const hrs = Math.max(1, Math.round(cfg.disputeWindowMs / 3_600_000));
      effects.push({
        type: 'notify',
        audience: 'both',
        text: `Deal ${d.dealId} is DISPUTED${payload.reason ? ` ("${payload.reason}")` : ''}. Both parties have ${hrs}h to submit evidence via deal.evidence. An AI arbiter will then read the deliverable and all evidence and rule a split, minus the ${cfg.disputeFeeBps / 100}% arbitration fee. Funds stay in escrow until then.`,
      });
      break;
    }
    case DealEvent.RESOLVE: {
      const buyerBps = payload.buyerBps ?? 10_000; // fail safe = full refund
      const { toBuyer, toSeller, fee } = arbitrationSplit(amount, buyerBps, cfg.disputeFeeBps);
      d.settlementJson = JSON.stringify({
        toBuyer: toBuyer.toString(),
        toSeller: toSeller.toString(),
        fee: fee.toString(),
      });
      d.verdictJson = JSON.stringify({
        buyerBps,
        rationale: payload.rationale ?? '',
        arbiter: payload.arbiter ?? 'rule:default',
      });
      markActiveMilestone(d, 'resolved', {
        toBuyer: toBuyer.toString(),
        toSeller: toSeller.toString(),
        fee: fee.toString(),
      });
      if (toBuyer > 0n) {
        effects.push({
          type: 'payout',
          kind: 'arbitration',
          recipient: 'buyer',
          amount: toBuyer,
          memo: `notary arbitration refund deal ${d.dealId}`,
        });
      }
      if (toSeller > 0n) {
        effects.push({
          type: 'payout',
          kind: 'arbitration',
          recipient: 'seller',
          amount: toSeller,
          memo: `notary arbitration release deal ${d.dealId}`,
        });
      }
      const pct = (buyerBps / 100).toFixed(0);
      effects.push({
        type: 'notify',
        audience: 'both',
        text: `Deal ${d.dealId} RESOLVED by ${payload.arbiter ?? 'the arbiter'}: ${pct}% to the buyer (${toBuyer}), ${100 - Number(pct)}% to the seller (${toSeller}), ${fee} retained as the arbitration fee.${payload.rationale ? ` Reasoning: ${payload.rationale}` : ''}`,
      });
      break;
    }
  }

  return { ok: true, deal: d, effects };
}
