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

/** Hard cap on milestones per deal — bounds token/DB cost and keeps the invite readable.
 *  The agent may enforce a lower cap via config (MAX_MILESTONES). */
export const MILESTONE_HARD_CAP = 20 as const;

// ---------------------------------------------------------------------------
// Deal states & events
// ---------------------------------------------------------------------------

export const DealState = {
  PROPOSED: 'PROPOSED',
  AWAITING_FUNDS: 'AWAITING_FUNDS',
  FUNDED: 'FUNDED',
  DELIVERED_CLAIMED: 'DELIVERED_CLAIMED',
  RELEASE_PENDING: 'RELEASE_PENDING', // confirm window lapsed; short appeal window before the silent release finalizes
  DISPUTED: 'DISPUTED', //   buyer disputed; evidence window open before arbitration
  RELEASED: 'RELEASED',
  REFUNDED: 'REFUNDED',
  RESOLVED: 'RESOLVED', //   arbitration decided a split between buyer & seller
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type DealState = (typeof DealState)[keyof typeof DealState];

export const DEAL_STATES = Object.values(DealState) as DealState[];

export const TERMINAL_STATES: ReadonlySet<DealState> = new Set([
  DealState.RELEASED,
  DealState.REFUNDED,
  DealState.RESOLVED,
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
  DISPUTE: 'DISPUTE', //             buyer disputes delivery → opens arbitration
  CONFIRM_TIMEOUT: 'CONFIRM_TIMEOUT', // buyer silence → opens a short appeal window (no longer an instant release)
  APPEAL_TIMEOUT: 'APPEAL_TIMEOUT', // appeal window lapsed with no dispute = silent release finalizes
  RESOLVE: 'RESOLVE', //             arbiter's verdict settles a dispute (agent-internal)
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
    [DealEvent.DISPUTE]: DealState.DISPUTED, // v2: opens an evidence-based arbitration
    [DealEvent.CONFIRM_TIMEOUT]: DealState.RELEASE_PENDING, // silence opens a short appeal window, not an instant release
  },
  [DealState.RELEASE_PENDING]: {
    [DealEvent.CONFIRM]: DealState.RELEASED, //   buyer woke up and confirmed → release now
    [DealEvent.DISPUTE]: DealState.DISPUTED, //   buyer woke up and rejects the delivery → arbitration
    [DealEvent.APPEAL_TIMEOUT]: DealState.RELEASED, // appeal window lapsed too → the silence rule finalizes
  },
  [DealState.DISPUTED]: {
    [DealEvent.RESOLVE]: DealState.RESOLVED, // arbiter's split verdict is final
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

/**
 * v2 arbitration rule: the notary retains its arbitration fee off the top,
 * then the arbiter's verdict splits the remainder. `buyerBps` is the share of
 * the post-fee remainder awarded to the buyer (0 = seller keeps everything,
 * 10000 = full refund). The seller receives the rest — no dust is lost.
 */
export function arbitrationSplit(
  amount: bigint,
  buyerBps: number,
  disputeFeeBps: number,
): { toBuyer: bigint; toSeller: bigint; fee: bigint } {
  if (!Number.isInteger(buyerBps) || buyerBps < 0 || buyerBps > 10_000) {
    throw new RangeError('buyerBps must be an integer in [0, 10000]');
  }
  const fee = computeFee(amount, disputeFeeBps);
  const remainder = amount - fee;
  const toBuyer = (remainder * BigInt(buyerBps)) / BPS_DENOMINATOR;
  const toSeller = remainder - toBuyer; // remainder − toBuyer keeps the sum exact
  return { toBuyer, toSeller, fee };
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
const zOfferId = z.string().min(4).max(64);

/** Fractional hours allowed (0.05 = 3 min) — used by fast demo/timeout runs. */
const zDeliveryHours = z.number().positive().max(24 * 30);

/** One stage of a milestone deal. Each is funded / delivered / released in order. */
export const MilestoneSchema = z.object({
  amount: zAmount,
  deliverable: z.string().min(1).max(2000),
  deliveryHours: zDeliveryHours.optional(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/** A milestone as it appears in a live snapshot — carries its running state. */
export const MilestoneStateSchema = z.object({
  index: z.number().int().nonnegative(),
  amount: zAmount,
  deliverable: z.string(),
  deliveryHours: z.number().positive(),
  state: z.enum(['pending', 'active', 'released', 'refunded', 'resolved']),
  settlement: z
    .object({ toSeller: zAmount.optional(), toBuyer: zAmount.optional(), fee: zAmount.optional() })
    .optional(),
});
export type MilestoneStateEntry = z.infer<typeof MilestoneStateSchema>;

// -- customer → notary ------------------------------------------------------

// The either/or rule (single amount+deliverable vs milestones[]) is enforced by
// the agent handler with a clear BAD_MESSAGE — a discriminatedUnion member must
// stay a plain object, and semantic validation already lives in the handlers.
export const DealOpenSchema = z.object({
  ...base,
  type: z.literal('deal.open'),
  seller: zPartyRef,
  coinId: z.string().min(1),
  // Single-shot escrow: amount + deliverable. Omitted when `milestones` is used.
  amount: zAmount.optional(),
  deliverable: z.string().min(1).max(2000).optional(),
  deliveryHours: zDeliveryHours.optional(),
  // Staged escrow: an ordered list funded/delivered/released one at a time.
  // Mutually exclusive with the single amount+deliverable form.
  milestones: z.array(MilestoneSchema).min(2).max(MILESTONE_HARD_CAP).optional(),
  // Set when the deal was opened from a marketplace offer (provenance only).
  fromOffer: zOfferId.optional(),
});

/** Returns null if `m` satisfies the exactly-one-of {single, milestones} rule,
 *  else a human-readable reason. Shared so web and agent report it identically. */
export function validateDealShape(m: {
  amount?: string;
  deliverable?: string;
  milestones?: unknown[];
}): string | null {
  const hasSingle = m.amount !== undefined && m.deliverable !== undefined;
  const hasMilestones = m.milestones !== undefined && m.milestones.length > 0;
  if (hasSingle === hasMilestones) {
    return 'Provide either (amount + deliverable) for a single deal OR milestones[] for a staged deal — not both or neither.';
  }
  return null;
}

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

/** Either party submits evidence while a deal is DISPUTED (before the arbiter rules). */
export const DealEvidenceSchema = z.object({
  ...base,
  type: z.literal('deal.evidence'),
  dealId: zDealId,
  statement: z.string().min(1).max(4000),
  proof: z.string().max(2000).optional(), // URL / hash / reference
  /** Optional sealed settlement proposal: the buyer's share of the escrow
   *  (0–10000 bps) this party is willing to accept. When both parties propose
   *  splits within tolerance, the deal auto-settles at the midpoint with no
   *  arbiter. Kept sealed from the counterparty until both have proposed, so
   *  neither can anchor to the other's number. */
  proposeBuyerBps: z.number().int().min(0).max(10_000).optional(),
});

export const DealStatusSchema = z.object({
  ...base,
  type: z.literal('deal.status'),
  dealId: zDealId,
});

// -- marketplace: seller offers ---------------------------------------------

/** Seller posts a public offer ("I'll do X for Y"). The agent curates it, mirrors
 *  it to the signed-intent market, and lists it so buyers can open a deal from it. */
export const OfferPostSchema = z.object({
  ...base,
  type: z.literal('offer.post'),
  title: z.string().min(3).max(120),
  coinId: z.string().min(1),
  // Single-price offer OR a staged (milestone) offer — same either/or rule as deal.open,
  // enforced by the agent handler via validateDealShape().
  amount: zAmount.optional(),
  deliverable: z.string().min(1).max(2000).optional(),
  deliveryHours: zDeliveryHours.optional(),
  milestones: z.array(MilestoneSchema).min(2).max(MILESTONE_HARD_CAP).optional(),
  expiresInDays: z.number().int().positive().max(90).optional(),
});

export const OfferCloseSchema = z.object({
  ...base,
  type: z.literal('offer.close'),
  offerId: zOfferId,
});

/** notary → seller: confirmation that an offer is live. */
export const OfferPostedSchema = z.object({
  ...base,
  type: z.literal('offer.posted'),
  offerId: zOfferId,
  marketIntentId: z.string().optional(), // present if the market mirror succeeded
});

/** Public offer as served by the read-only API / rendered by the web marketplace. */
export const OfferSchema = z.object({
  offerId: zOfferId,
  sellerTag: z.string(),
  title: z.string(),
  deliverable: z.string(),
  amount: zAmount, //          total price (sum across milestones for a staged offer)
  coinId: z.string(),
  symbol: z.string().optional(),
  deliveryHours: z.number().positive(),
  milestones: z.array(MilestoneSchema).optional(),
  status: z.enum(['open', 'closed', 'expired']),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type Offer = z.infer<typeof OfferSchema>;

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
  // For staged deals: the full milestone plan the seller is accepting. `amount`
  // above is the FIRST milestone; `totalAmount` is the sum across all stages.
  milestones: z.array(MilestoneSchema).optional(),
  totalAmount: zAmount.optional(),
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
  amount: zAmount, //   for a staged deal this is the ACTIVE milestone's amount
  coinId: z.string(),
  symbol: z.string().optional(),
  feeBps: z.number().int(),
  deliverable: z.string(), // active milestone's deliverable for a staged deal
  deliveryHours: z.number().positive(),
  createdAt: z.number().int(),
  deadlineAt: z.number().int().nullable(), // active timer for current state
  // Staged escrow: the full plan + which milestone is active. Absent for single deals.
  milestones: z.array(MilestoneStateSchema).optional(),
  currentMilestone: z.number().int().nonnegative().optional(),
  totalAmount: zAmount.optional(), // sum across milestones (= amount for single deals)
  settlement: z
    .object({
      toSeller: zAmount.optional(),
      toBuyer: zAmount.optional(),
      fee: zAmount.optional(),
      transferIds: z.array(z.string()).optional(),
    })
    .optional(),
  // Arbitration record — present once a deal has been disputed.
  dispute: z
    .object({
      reason: z.string().optional(), //        buyer's stated grievance
      buyerEvidence: z.string().optional(), //  buyer's submitted evidence
      sellerEvidence: z.string().optional(), // seller's submitted evidence
      verdict: z
        .object({
          buyerBps: z.number().int(), // share of post-fee escrow awarded to buyer
          rationale: z.string(),
          arbiter: z.string(), //       e.g. "claude-opus-4-8" or "rule:default"
        })
        .optional(),
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
  DealEvidenceSchema,
  DealStatusSchema,
  DealUpdateSchema,
  OfferPostSchema,
  OfferCloseSchema,
  OfferPostedSchema,
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
export type DealEvidence = z.infer<typeof DealEvidenceSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type DealUpdate = z.infer<typeof DealUpdateSchema>;
export type OfferPost = z.infer<typeof OfferPostSchema>;
export type OfferClose = z.infer<typeof OfferCloseSchema>;
export type OfferPosted = z.infer<typeof OfferPostedSchema>;
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
  {"v":1,"type":"deal.open","seller":"@bob","coinId":"...","milestones":[{"amount":"...","deliverable":"...","deliveryHours":72},...]} (staged escrow)
  {"v":1,"type":"deal.accept","dealId":"..."}     (seller)
  {"v":1,"type":"deal.reject","dealId":"..."}     (seller)
  {"v":1,"type":"deal.delivered","dealId":"...","proof":"..."} (seller)
  {"v":1,"type":"deal.confirm","dealId":"..."}    (buyer)
  {"v":1,"type":"deal.dispute","dealId":"...","reason":"..."} (buyer)
  {"v":1,"type":"deal.evidence","dealId":"...","statement":"...","proof":"...","proposeBuyerBps":5000} (either party, while DISPUTED; proposeBuyerBps optional)
  {"v":1,"type":"deal.status","dealId":"..."}
  {"v":1,"type":"offer.post","title":"...","amount":"<base units>","coinId":"...","deliverable":"...","deliveryHours":72} (seller lists a public offer)
  {"v":1,"type":"offer.close","offerId":"..."}    (seller)

Flow: open → seller accepts → I send the buyer a payment request → funded → seller delivers → buyer confirms (or the confirm window lapses → a short appeal window opens with a final warning → then release) → I pay the seller minus fee. A staged (milestone) deal runs this loop once per milestone, funding and releasing each in order. A dispute opens an evidence window: both parties send deal.evidence, optionally including proposeBuyerBps — a sealed proposed split. If both proposed splits roughly agree, the deal auto-settles at the midpoint with no arbiter; otherwise an AI arbiter reads the deliverable + evidence and rules a split (buyer/seller) minus the arbitration fee. Timeouts auto-refund. Sellers can also post a public offer with offer.post so buyers discover and open deals from it.`;
