/**
 * Pure deal state machine. No I/O, no SDK, no clock — everything injected.
 * Returns the mutated-copy deal row plus a list of effects for the runtime
 * (dealService) to execute. Illegal transitions return an error, never throw.
 */
import {
  DealEvent,
  DealState,
  disputeSplit,
  nextState,
  releaseSplit,
} from '@notary/shared';
import type { DealRow } from './db.js';

export interface MachineConfig {
  disputeFeeBps: number;
  fundingTimeoutMs: number;
  confirmTimeoutMs: number;
}

export type EventPayload = {
  sellerPubkey?: string; // ACCEPT — learn the seller's transport pubkey
  reason?: string; //       REJECT / DISPUTE
  proof?: string; //        DELIVERED
  transferId?: string; //   FUNDS_RECEIVED
};

export type Effect =
  | { type: 'send_payment_request' } //  buyer funds escrow (on ACCEPT)
  | {
      type: 'payout';
      kind: 'release' | 'refund' | 'dispute_refund';
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
      const { toBuyer, fee } = disputeSplit(amount, cfg.disputeFeeBps);
      d.settlementJson = JSON.stringify({ toBuyer: toBuyer.toString(), fee: fee.toString() });
      effects.push(
        {
          type: 'payout',
          kind: 'dispute_refund',
          recipient: 'buyer',
          amount: toBuyer,
          memo: `notary dispute refund deal ${d.dealId}`,
        },
        {
          type: 'notify',
          audience: 'both',
          text: `Deal ${d.dealId} DISPUTED${payload.reason ? ` ("${payload.reason}")` : ''}. v1 arbitration rule: buyer refunded ${toBuyer}, ${fee} retained as the dispute fee. Sellers who disagree can escalate off-band; v2 will add evidence-based arbitration.`,
        },
      );
      break;
    }
  }

  return { ok: true, deal: d, effects };
}
