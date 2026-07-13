/**
 * Notary wire protocol v1.
 *
 * Single source of truth for every DM exchanged with the @notary agent,
 * the deal state machine, and fee math. Consumed by both packages/agent
 * (to enforce) and packages/web (to render the exact same rules).
 *
 * All token amounts on the wire are STRINGS of integer base units
 * (JSON cannot carry bigint). Convert at the edges with amountToBigint().
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Deal states & events
// ---------------------------------------------------------------------------

export const DealState = {
  PROPOSED: 'PROPOSED',
  AWAITING_FUNDS: 'AWAITING_FUNDS',
  FUNDED: 'FUNDED',
  DELIVERED_CLAIMED: 'DELIVERED_CLAIMED',
  RELEASED: 'RELEASED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type DealState = (typeof DealState)[keyof typeof DealState];

export const DEAL_STATES = Object.values(DealState) as DealState[];

export const TERMINAL_STATES: ReadonlySet<DealState> = new Set([
  DealState.RELEASED,
  DealState.REFUNDED,
  DealState.CANCELLED,
  DealState.EXPIRED,
]);

/** Everything that can move a deal between states. */
export const DealEvent = {
  ACCEPT: 'ACCEPT', //               seller accepted the invite
  REJECT: 'REJECT', //               seller rejected the invite
  ACCEPT_TIMEOUT: 'ACCEPT_TIMEOUT',
  FUNDS_RECEIVED: 'FUNDS_RECEIVED', // payment request paid & transfer landed
  FUNDING_TIMEOUT: 'FUNDING_TIMEOUT',
  DELIVERED: 'DELIVERED', //         seller claims delivery
  DELIVERY_TIMEOUT: 'DELIVERY_TIMEOUT',
  CONFIRM: 'CONFIRM', //             buyer confirms delivery
  DISPUTE: 'DISPUTE', //             buyer disputes delivery
  CONFIRM_TIMEOUT: 'CONFIRM_TIMEOUT', // buyer silence = acceptance
} as const;
export type DealEvent = (typeof DealEvent)[keyof typeof DealEvent];

/**
 * The legal-transition table. A missing entry means the event is illegal in
 * that state. The agent enforces this; the web renders it as a stepper.
 */
export const LEGAL_TRANSITIONS: Readonly<
  Partial<Record<DealState, Partial<Record<DealEvent, DealState>>>>
> = {
  [DealState.PROPOSED]: {
    [DealEvent.ACCEPT]: DealState.AWAITING_FUNDS,
    [DealEvent.REJECT]: DealState.CANCELLED,
    [DealEvent.ACCEPT_TIMEOUT]: DealState.CANCELLED,
  },
  [DealState.AWAITING_FUNDS]: {
    [DealEvent.FUNDS_RECEIVED]: DealState.FUNDED,
    [DealEvent.FUNDING_TIMEOUT]: DealState.EXPIRED,
  },
  [DealState.FUNDED]: {
    [DealEvent.DELIVERED]: DealState.DELIVERED_CLAIMED,
    [DealEvent.DELIVERY_TIMEOUT]: DealState.REFUNDED,
  },
  [DealState.DELIVERED_CLAIMED]: {
    [DealEvent.CONFIRM]: DealState.RELEASED,
    [DealEvent.DISPUTE]: DealState.REFUNDED, // v1 deterministic arbitration
    [DealEvent.CONFIRM_TIMEOUT]: DealState.RELEASED, // silence = acceptance
  },
};

/** Returns the next state, or null if the event is illegal in `from`. */
export function nextState(from: DealState, event: DealEvent): DealState | null {
  return LEGAL_TRANSITIONS[from]?.[event] ?? null;
}

/** Ordered happy path, for rendering the stepper in the web app. */
export const HAPPY_PATH: readonly DealState[] = [
  DealState.PROPOSED,
  DealState.AWAITING_FUNDS,
  DealState.FUNDED,
  DealState.DELIVERED_CLAIMED,
  DealState.RELEASED,
];

// ---------------------------------------------------------------------------
// Fee math (bigint, basis points). Never floats.
// ---------------------------------------------------------------------------

export const BPS_DENOMINATOR = 10_000n;

/** Escrow fee, floored. amount * feeBps / 10_000. */
export function computeFee(amount: bigint, feeBps: number): bigint {
  if (amount < 0n) throw new RangeError('amount must be >= 0');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new RangeError('feeBps must be an integer in [0, 10000]');
  }
  return (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
}

/** What the seller receives on RELEASE: amount minus the notary fee. */
export function releaseSplit(
  amount: bigint,
  feeBps: number,
): { toSeller: bigint; fee: bigint } {
  const fee = computeFee(amount, feeBps);
  return { toSeller: amount - fee, fee };
}

/**
 * v1 dispute rule: buyer is refunded minus a small dispute fee retained by
 * the notary (covers arbitration cost, discourages frivolous disputes).
 */
export function disputeSplit(
  amount: bigint,
  disputeFeeBps: number,
): { toBuyer: bigint; fee: bigint } {
  const fee = computeFee(amount, disputeFeeBps);
  return { toBuyer: amount - fee, fee };
}

/** Parse a wire amount string into bigint base units; throws on garbage. */
export function amountToBigint(s: string): bigint {
  if (!/^\d+$/.test(s)) throw new RangeError(`not an integer base-unit amount: ${s}`);
  return BigInt(s);
}

// ---------------------------------------------------------------------------
// Wire schemas — every DM is JSON: { v: 1, type: "...", ... }
// ---------------------------------------------------------------------------

const base = { v: z.literal(PROTOCOL_VERSION) };

/** Integer base units as a string (bigint-safe on the wire). */
export const zAmount = z.string().regex(/^\d+$/, 'integer base units required');

/** A nametag ("@alice" or "alice") or a DIRECT:// address / pubkey. */
export const zPartyRef = z.string().min(1).max(256);

const zDealId = z.string().min(4).max(64);

// -- customer → notary ------------------------------------------------------

export const DealOpenSchema = z.object({
  ...base,
  type: z.literal('deal.open'),
  seller: zPartyRef,
  amount: zAmount,
  coinId: z.string().min(1),
  deliverable: z.string().min(1).max(2000),
  // Fractional hours allowed (0.05 = 3 min) — used by fast demo/timeout runs.
  deliveryHours: z.number().positive().max(24 * 30).optional(),
});

export const DealAcceptSchema = z.object({
  ...base,
  type: z.literal('deal.accept'),
  dealId: zDealId,
});

export const DealRejectSchema = z.object({
  ...base,
  type: z.literal('deal.reject'),
  dealId: zDealId,
  reason: z.string().max(1000).optional(),
});

export const DealDeliveredSchema = z.object({
  ...base,
  type: z.literal('deal.delivered'),
  dealId: zDealId,
  proof: z.string().max(2000).optional(),
});

export const DealConfirmSchema = z.object({
  ...base,
  type: z.literal('deal.confirm'),
  dealId: zDealId,
});

export const DealDisputeSchema = z.object({
  ...base,
  type: z.literal('deal.dispute'),
  dealId: zDealId,
  reason: z.string().max(2000).optional(),
});

export const DealStatusSchema = z.object({
  ...base,
  type: z.literal('deal.status'),
  dealId: zDealId,
});

// -- notary → customers -----------------------------------------------------

export const DealInviteSchema = z.object({
  ...base,
  type: z.literal('deal.invite'),
  dealId: zDealId,
  buyer: zPartyRef,
  seller: zPartyRef,
  amount: zAmount,
  coinId: z.string().min(1),
  symbol: z.string().optional(),
  deliverable: z.string(),
  deliveryHours: z.number().positive(),
  feeBps: z.number().int().min(0).max(10_000),
  acceptBy: z.number().int().positive(), // unix ms deadline
});

export const DealFundedSchema = z.object({
  ...base,
  type: z.literal('deal.funded'),
  dealId: zDealId,
  amount: zAmount,
  coinId: z.string().min(1),
  deliverBy: z.number().int().positive(), // unix ms deadline
});

/** One entry in a deal's append-only ledger (public trail). */
export const DealLedgerEventSchema = z.object({
  at: z.number().int().nonnegative(), // unix ms
  event: z.string(), //                e.g. "ACCEPT", "PAYOUT_SENT"
  detail: z.string().optional(),
});

/** Full deal snapshot — the web app's live-update payload. */
export const DealSnapshotSchema = z.object({
  dealId: zDealId,
  state: z.enum(DEAL_STATES as [DealState, ...DealState[]]),
  buyer: z.string(), //   pubkey (hex) of the buyer
  // Empty until the seller accepts (their pubkey is unknown while PROPOSED).
  seller: z.string(),
  buyerTag: z.string().optional(),
  sellerTag: z.string().optional(),
  amount: zAmount,
  coinId: z.string(),
  symbol: z.string().optional(),
  feeBps: z.number().int(),
  deliverable: z.string(),
  deliveryHours: z.number().positive(),
  createdAt: z.number().int(),
  deadlineAt: z.number().int().nullable(), // active timer for current state
  settlement: z
    .object({
      toSeller: zAmount.optional(),
      toBuyer: zAmount.optional(),
      fee: zAmount.optional(),
      transferIds: z.array(z.string()).optional(),
    })
    .optional(),
  events: z.array(DealLedgerEventSchema).optional(),
});
export type DealSnapshot = z.infer<typeof DealSnapshotSchema>;

export const DealUpdateSchema = z.object({
  ...base,
  type: z.literal('deal.update'),
  deal: DealSnapshotSchema,
});

export const ErrorCode = {
  BAD_MESSAGE: 'BAD_MESSAGE',
  UNKNOWN_DEAL: 'UNKNOWN_DEAL',
  NOT_YOUR_DEAL: 'NOT_YOUR_DEAL',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  UNRESOLVABLE_PARTY: 'UNRESOLVABLE_PARTY',
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',
  UNSUPPORTED_COIN: 'UNSUPPORTED_COIN',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ProtocolErrorSchema = z.object({
  ...base,
  type: z.literal('error'),
  code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
  message: z.string(),
  dealId: zDealId.optional(),
});

// -- envelope ---------------------------------------------------------------

export const NotaryMessageSchema = z.discriminatedUnion('type', [
  DealOpenSchema,
  DealInviteSchema,
  DealAcceptSchema,
  DealRejectSchema,
  DealFundedSchema,
  DealDeliveredSchema,
  DealConfirmSchema,
  DealDisputeSchema,
  DealStatusSchema,
  DealUpdateSchema,
  ProtocolErrorSchema,
]);
export type NotaryMessage = z.infer<typeof NotaryMessageSchema>;

export type DealOpen = z.infer<typeof DealOpenSchema>;
export type DealInvite = z.infer<typeof DealInviteSchema>;
export type DealAccept = z.infer<typeof DealAcceptSchema>;
export type DealReject = z.infer<typeof DealRejectSchema>;
export type DealFunded = z.infer<typeof DealFundedSchema>;
export type DealDelivered = z.infer<typeof DealDeliveredSchema>;
export type DealConfirm = z.infer<typeof DealConfirmSchema>;
export type DealDispute = z.infer<typeof DealDisputeSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type DealUpdate = z.infer<typeof DealUpdateSchema>;
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;

export function encodeMessage(msg: NotaryMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse an inbound DM body. Returns the typed message, or null when the text
 * is not protocol JSON at all (plain chat — the agent answers with help),
 * or { malformed: true } when it *tried* to be protocol but failed validation.
 */
export type ParseResult =
  | { ok: true; msg: NotaryMessage }
  | { ok: false; malformed: boolean; issues?: string };

export function parseMessage(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, malformed: false };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, malformed: false };
  const res = NotaryMessageSchema.safeParse(raw);
  if (res.success) return { ok: true, msg: res.data };
  return {
    ok: false,
    malformed: true,
    issues: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

/** Human help text the agent replies with to any non-protocol DM. */
export const HELP_TEXT = `I'm @notary — an autonomous escrow agent. I hold funds between a buyer and a seller and settle for a 1% fee.

Commands (send as JSON DM):
  {"v":1,"type":"deal.open","seller":"@bob","amount":"<base units>","coinId":"...","deliverable":"...","deliveryHours":72}
  {"v":1,"type":"deal.accept","dealId":"..."}     (seller)
  {"v":1,"type":"deal.reject","dealId":"..."}     (seller)
  {"v":1,"type":"deal.delivered","dealId":"...","proof":"..."} (seller)
  {"v":1,"type":"deal.confirm","dealId":"..."}    (buyer)
  {"v":1,"type":"deal.dispute","dealId":"...","reason":"..."} (buyer)
  {"v":1,"type":"deal.status","dealId":"..."}

Flow: open → seller accepts → I send the buyer a payment request → funded → seller delivers → buyer confirms (or 48h silence) → I pay the seller minus fee. Disputes in v1 refund the buyer minus a small dispute fee. Timeouts auto-refund.`;
