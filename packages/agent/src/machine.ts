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
          text: `Deal ${d.dealId}: seller missed the delivery window. Buyer refunded in full (${amount} base units).`,
        },
      );
      break;
    }
    case DealEvent.CONFIRM:
    case DealEvent.CONFIRM_TIMEOUT: {
      const { toSeller, fee } = releaseSplit(amount, d.feeBps);
      d.settlementJson = JSON.stringify({ toSeller: toSeller.toString(), fee: fee.toString() });
      const why = event === DealEvent.CONFIRM ? 'buyer confirmed delivery' : 'confirmation window lapsed (silence = acceptance)';
      effects.push(
        {
          type: 'payout',
          kind: 'release',
          recipient: 'seller',
          amount: toSeller,
          memo: `notary release deal ${d.dealId}`,
        },
        {
          type: 'notify',
          audience: 'both',
          text: `Deal ${d.dealId} RELEASED (${why}): ${toSeller} to seller, ${fee} retained as the notary fee.`,
        },
      );
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
