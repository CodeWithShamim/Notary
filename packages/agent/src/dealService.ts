import { randomUUID } from 'node:crypto';
import {
  getCoinIdBySymbol,
  getTokenSymbol,
  isSphereError,
  type DirectMessage,
  type PaymentRequestResponse,
  type Sphere,
} from '@unicitylabs/sphere-sdk';
import {
  DealEvent,
  DealState,
  ErrorCode,
  HELP_TEXT,
  TERMINAL_STATES,
  amountToBigint,
  encodeMessage,
  parseMessage,
  validateDealShape,
  type DealOpen,
  type DealSnapshot,
  type Milestone,
  type MilestoneStateEntry,
  type NotaryMessage,
  type OfferPost,
} from '@notary/shared';
import { config } from './config.js';
import { dealLogger, logger } from './logger.js';
import { TIMEOUT_EVENT_FOR_STATE, transition, type Effect, type MilestonePlanEntry } from './machine.js';
import { judge, type Verdict } from './arbiter.js';
import { withRetry } from './retry.js';
import type { DealRow, OfferRow, PayoutRow, Store } from './db.js';

const machineCfg = {
  disputeFeeBps: config.disputeFeeBps,
  fundingTimeoutMs: config.fundingTimeoutMs,
  confirmTimeoutMs: config.confirmTimeoutMs,
  disputeWindowMs: config.disputeWindowMs,
  appealWindowMs: config.appealWindowMs,
};

export class DealService {
  private unsubs: (() => void)[] = [];
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  /** Serializes all state mutations — one deal event at a time, no races. */
  private chain: Promise<void> = Promise.resolve();
  /** Optional hook so a DM can pull the agent into a NIP-29 group. */
  private groupWatcher: ((groupId: string) => Promise<boolean>) | null = null;

  constructor(
    private readonly sphere: Sphere,
    private readonly store: Store,
  ) {}

  setGroupWatcher(fn: (groupId: string) => Promise<boolean>): void {
    this.groupWatcher = fn;
  }

  start(): void {
    this.unsubs.push(
      this.sphere.communications.onDirectMessage((msg) => this.enqueue(() => this.onDM(msg))),
      this.sphere.payments.onPaymentRequestResponse((res) => this.enqueue(() => this.onPaymentResponse(res))),
    );
    this.timers.push(
      setInterval(() => this.enqueue(() => this.tickTimers()), config.timerPollMs),
      setInterval(() => this.enqueue(() => this.runPayoutExecutor()), 30_000),
      setInterval(() => void this.resumeIntents(), config.resumeIntentsEveryMs),
      setInterval(() => this.store.pruneIdempotency(7 * 24 * 3_600_000), 3_600_000),
    );
    // Catch anything that expired or was left pending while we were down.
    this.enqueue(() => this.tickTimers());
    this.enqueue(() => this.runPayoutExecutor());
    logger.info('deal service started (timers rehydrated from persisted deadlines)');
  }

  stop(): void {
    this.stopped = true;
    for (const u of this.unsubs) u();
    for (const t of this.timers) clearInterval(t);
  }

  /** All mutating work funnels through one promise chain (simple actor model). */
  private enqueue(fn: () => Promise<void>): void {
    if (this.stopped) return;
    this.chain = this.chain.then(fn).catch((err) => logger.error({ err }, 'deal service task failed'));
  }

  // ---------------------------------------------------------------------------
  // Inbound DMs
  // ---------------------------------------------------------------------------

  private async onDM(msg: DirectMessage): Promise<void> {
    // Ephemeral mode skips SDK dedup — this table is the only replay guard.
    if (!this.store.markProcessed(msg.id, msg.senderPubkey)) return;

    const watchMatch = msg.content.trim().match(/^!pool watch (\S+)$/i);
    if (watchMatch?.[1]) {
      logger.info({ groupId: watchMatch[1], from: msg.senderNametag ?? msg.senderPubkey.slice(0, 12) }, '!pool watch requested');
      let ok = false;
      try {
        ok = await (this.groupWatcher?.(watchMatch[1]) ?? Promise.resolve(false));
      } catch (err) {
        logger.error({ err, groupId: watchMatch[1] }, 'watchGroup threw');
      }
      logger.info({ groupId: watchMatch[1], joined: ok }, '!pool watch result');
      await this.safeSendDM(msg.senderPubkey, ok ? `Watching group ${watchMatch[1]} for !pool commands.` : 'Could not join that group.');
      return;
    }

    const parsed = parseMessage(msg.content);
    if (!parsed.ok) {
      if (parsed.malformed) {
        await this.replyError(msg.senderPubkey, ErrorCode.BAD_MESSAGE, `Invalid message: ${parsed.issues ?? 'schema mismatch'}`);
      } else if (!this.looksLikeOwnProtocolTraffic(msg.content)) {
        await this.safeSendDM(msg.senderPubkey, HELP_TEXT);
      }
      return;
    }

    const m = parsed.msg;
    logger.info({ type: m.type, from: msg.senderNametag ?? msg.senderPubkey.slice(0, 12) }, 'DM command');
    try {
      switch (m.type) {
        case 'deal.open':
          return await this.handleOpen(msg, m);
        case 'deal.accept':
          return await this.handlePartyEvent(msg, m.dealId, 'seller', DealEvent.ACCEPT, { sellerPubkey: msg.senderPubkey });
        case 'deal.reject':
          return await this.handlePartyEvent(msg, m.dealId, 'seller', DealEvent.REJECT, { reason: m.reason });
        case 'deal.delivered':
          return await this.handlePartyEvent(msg, m.dealId, 'seller', DealEvent.DELIVERED, { proof: m.proof });
        case 'deal.confirm':
          return await this.handlePartyEvent(msg, m.dealId, 'buyer', DealEvent.CONFIRM, {});
        case 'deal.dispute':
          return await this.handlePartyEvent(msg, m.dealId, 'buyer', DealEvent.DISPUTE, { reason: m.reason });
        case 'deal.evidence':
          return await this.handleEvidence(msg, m.dealId, m.statement, m.proof, m.proposeBuyerBps);
        case 'deal.status':
          return await this.handleStatus(msg, m.dealId);
        case 'offer.post':
          return await this.handleOfferPost(msg, m);
        case 'offer.close':
          return await this.handleOfferClose(msg, m.offerId);
        default:
          // Protocol messages the agent itself emits (deal.update, deal.invite,
          // error, ...) arriving inbound are echoes/noise — ignore.
          return;
      }
    } catch (err) {
      logger.error({ err, type: m.type }, 'command handler failed');
      const dealId = 'dealId' in m ? m.dealId : undefined;
      await this.replyError(msg.senderPubkey, ErrorCode.INTERNAL, 'Internal error — the deal state is unchanged. Try again.', dealId);
    }
  }

  /** Don't answer our own outbound message kinds with HELP (avoids reply loops with other bots). */
  private looksLikeOwnProtocolTraffic(text: string): boolean {
    return text.includes('"deal.update"') || text.includes('"deal.invite"') || text.includes('"error"');
  }

  private async handleOpen(msg: DirectMessage, m: DealOpen): Promise<void> {
    // Enforce the single-vs-staged shape (schema keeps both optional so it can
    // stay a discriminated-union member; the meaning is checked here).
    const shapeErr = validateDealShape(m);
    if (shapeErr) return this.replyError(msg.senderPubkey, ErrorCode.BAD_MESSAGE, shapeErr);

    // Build the milestone plan (staged) or a single-leg plan, validating amounts.
    const built = this.buildPlan(m.milestones, m.amount, m.deliverable, m.deliveryHours);
    if ('error' in built) return this.replyError(msg.senderPubkey, built.code, built.error);
    const { plan, totalAmount, active } = built;

    if (totalAmount < config.minEscrow || totalAmount > config.maxEscrow) {
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.AMOUNT_OUT_OF_RANGE,
        `Total escrow must be between ${config.minEscrow} and ${config.maxEscrow} base units${plan ? ' (summed across milestones)' : ''}.`,
      );
    }

    // Coin: accept a registry symbol or a hex coinId; resolve a display symbol either way.
    const bySymbol = getCoinIdBySymbol(m.coinId);
    const coinId = bySymbol ?? m.coinId;
    const symbol = bySymbol ? m.coinId.toUpperCase() : (getTokenSymbol(coinId) || null);
    if (config.allowedCoins.length && !config.allowedCoins.includes(coinId) && !(symbol && config.allowedCoins.includes(symbol))) {
      return this.replyError(msg.senderPubkey, ErrorCode.UNSUPPORTED_COIN, `This notary escrows only: ${config.allowedCoins.join(', ')}`);
    }

    // Buyer must be payable (refunds!) — that means a registered nametag.
    const buyerTag =
      msg.senderNametag ?? (await this.sphere.communications.resolvePeerNametag(msg.senderPubkey).catch(() => undefined));
    if (!buyerTag) {
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.UNRESOLVABLE_PARTY,
        'You need a registered nametag before opening a deal — refunds are paid to it. Register one and retry.',
      );
    }
    const sellerTag = m.seller.replace(/^@/, '').toLowerCase();
    if (sellerTag === buyerTag.toLowerCase()) {
      return this.replyError(msg.senderPubkey, ErrorCode.BAD_MESSAGE, 'Buyer and seller must be different parties.');
    }

    const now = Date.now();
    const deal: DealRow = {
      dealId: `deal_${randomUUID().slice(0, 8)}`,
      state: DealState.PROPOSED,
      buyerPubkey: msg.senderPubkey,
      buyerTag,
      sellerPubkey: null,
      sellerTag,
      amount: active.amount, //           active (first) milestone amount for a staged deal
      coinId,
      symbol,
      feeBps: config.feeBps,
      deliverable: active.deliverable,
      deliveryHours: active.deliveryHours,
      proof: null,
      paymentRequestId: null,
      fundedTransferId: null,
      settlementJson: null,
      buyerEvidence: null,
      sellerEvidence: null,
      verdictJson: null,
      buyerProposalBps: null,
      sellerProposalBps: null,
      milestonesJson: plan ? JSON.stringify(plan) : null,
      currentMilestone: plan ? 0 : null,
      totalAmount: totalAmount.toString(),
      createdAt: now,
      deadlineAt: now + config.acceptTimeoutMs,
      updatedAt: now,
    };

    // Invite the seller FIRST — if their nametag doesn't resolve
    // (INVALID_RECIPIENT), the deal is never created.
    const log = dealLogger(deal.dealId);
    const inviteDeliverable = plan
      ? `Staged deal — ${plan.length} milestones, total ${deal.totalAmount} ${deal.symbol ?? deal.coinId}. First: ${active.deliverable}`
      : deal.deliverable;
    try {
      await this.sphere.communications.sendDM(
        `@${sellerTag}`,
        encodeMessage({
          v: 1,
          type: 'deal.invite',
          dealId: deal.dealId,
          buyer: buyerTag,
          seller: sellerTag,
          amount: deal.amount,
          coinId: deal.coinId,
          symbol: deal.symbol ?? undefined,
          deliverable: inviteDeliverable,
          deliveryHours: deal.deliveryHours,
          feeBps: deal.feeBps,
          acceptBy: deal.deadlineAt!,
          milestones: m.milestones,
          totalAmount: plan ? deal.totalAmount : undefined,
        }),
      );
    } catch (err) {
      log.warn({ err, sellerTag }, 'seller unresolvable');
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.UNRESOLVABLE_PARTY,
        `Seller @${sellerTag} has no published identity on the network — they must register a nametag first.`,
      );
    }

    this.store.insertDeal(deal);
    const shape = plan ? `${plan.length} milestones, total ${deal.totalAmount}` : `${deal.amount}`;
    this.store.addDealEvent(deal.dealId, 'OPENED', `buyer @${buyerTag} → seller @${sellerTag}, ${shape} ${deal.symbol ?? deal.coinId}`);
    this.store.addDealEvent(deal.dealId, 'INVITED', `acceptance deadline ${new Date(deal.deadlineAt!).toISOString()}`);
    log.info({ buyerTag, sellerTag, amount: deal.amount, milestones: plan?.length ?? 0 }, 'deal opened');
    await this.broadcastUpdate(deal);
  }

  /** Validate + normalize a deal/offer's amount shape into a milestone plan (or a
   *  single-leg plan) plus the summed total and the active (first) leg. Returns an
   *  error object on any invalid amount. Bounds on the TOTAL are checked by the caller. */
  private buildPlan(
    milestones: Milestone[] | undefined,
    singleAmount: string | undefined,
    singleDeliverable: string | undefined,
    singleHours: number | undefined,
  ):
    | { plan: MilestonePlanEntry[] | null; totalAmount: bigint; active: { amount: string; deliverable: string; deliveryHours: number } }
    | { error: string; code: ErrorCode } {
    if (milestones) {
      if (milestones.length > config.maxMilestones) {
        return { error: `Too many milestones (max ${config.maxMilestones}).`, code: ErrorCode.BAD_MESSAGE };
      }
      let total = 0n;
      const plan: MilestonePlanEntry[] = [];
      for (let i = 0; i < milestones.length; i++) {
        const ms = milestones[i]!;
        const a = amountToBigint(ms.amount); // zAmount already guarantees a non-negative integer string
        if (a <= 0n) return { error: `Milestone ${i + 1} amount must be greater than zero.`, code: ErrorCode.AMOUNT_OUT_OF_RANGE };
        total += a;
        plan.push({
          index: i,
          amount: a.toString(),
          deliverable: ms.deliverable,
          deliveryHours: ms.deliveryHours ?? config.defaultDeliveryHours,
          state: i === 0 ? 'active' : 'pending',
        });
      }
      return { plan, totalAmount: total, active: plan[0]! };
    }
    const amount = amountToBigint(singleAmount!);
    return {
      plan: null,
      totalAmount: amount,
      active: { amount: amount.toString(), deliverable: singleDeliverable!, deliveryHours: singleHours ?? config.defaultDeliveryHours },
    };
  }

  /** Shared path for all party-triggered events: authenticate, transition, execute. */
  private async handlePartyEvent(
    msg: DirectMessage,
    dealId: string,
    role: 'buyer' | 'seller',
    event: DealEvent,
    payload: { sellerPubkey?: string; reason?: string; proof?: string },
  ): Promise<void> {
    const deal = this.store.getDeal(dealId);
    if (!deal) return this.replyError(msg.senderPubkey, ErrorCode.UNKNOWN_DEAL, `No deal ${dealId}.`, dealId);

    if (!(await this.authenticate(deal, msg, role))) {
      return this.replyError(msg.senderPubkey, ErrorCode.NOT_YOUR_DEAL, `You are not the ${role} of ${dealId}.`, dealId);
    }

    const result = transition(deal, event, payload, Date.now(), machineCfg);
    if (!result.ok) {
      // Idempotency: re-sending confirm/accept after it already applied is a
      // no-op notification, not an error barrage.
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.ILLEGAL_TRANSITION,
        `Deal ${dealId} is in state ${deal.state} — '${event}' does not apply.`,
        dealId,
      );
    }
    await this.commit(result.deal, event, result.effects);
  }

  /** The buyer is pinned by pubkey at open. The seller is pinned on first authentic message. */
  private async authenticate(deal: DealRow, msg: DirectMessage, role: 'buyer' | 'seller'): Promise<boolean> {
    if (role === 'buyer') return msg.senderPubkey === deal.buyerPubkey;
    if (deal.sellerPubkey) return msg.senderPubkey === deal.sellerPubkey;
    const tag = msg.senderNametag ?? (await this.sphere.communications.resolvePeerNametag(msg.senderPubkey).catch(() => undefined));
    return tag?.toLowerCase() === deal.sellerTag.toLowerCase();
  }

  /** Either party submits evidence during the dispute window; the arbiter rules
   *  as soon as both sides have spoken, or when the window lapses (tickTimers). */
  private async handleEvidence(msg: DirectMessage, dealId: string, statement: string, proof?: string, proposeBuyerBps?: number): Promise<void> {
    const deal = this.store.getDeal(dealId);
    if (!deal) return this.replyError(msg.senderPubkey, ErrorCode.UNKNOWN_DEAL, `No deal ${dealId}.`, dealId);
    if (deal.state !== DealState.DISPUTED) {
      return this.replyError(msg.senderPubkey, ErrorCode.ILLEGAL_TRANSITION, `Deal ${dealId} is not open for evidence (state ${deal.state}).`, dealId);
    }

    let role: 'buyer' | 'seller';
    if (await this.authenticate(deal, msg, 'buyer')) role = 'buyer';
    else if (await this.authenticate(deal, msg, 'seller')) role = 'seller';
    else return this.replyError(msg.senderPubkey, ErrorCode.NOT_YOUR_DEAL, `You are not a party to ${dealId}.`, dealId);

    const entry = proof ? `${statement}\n[proof: ${proof}]` : statement;
    // Cap accumulated evidence per party: bounds the arbiter's token cost and
    // stops one side flooding many submissions to drown the other's evidence.
    const existingEvidence = (role === 'buyer' ? deal.buyerEvidence : deal.sellerEvidence) ?? '';
    if (existingEvidence.length + entry.length + 1 > config.disputeMaxEvidenceChars) {
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.BAD_MESSAGE,
        `Evidence limit reached for ${dealId} (max ${config.disputeMaxEvidenceChars} characters per party). Summarize your case and resubmit.`,
        dealId,
      );
    }
    if (role === 'buyer') deal.buyerEvidence = deal.buyerEvidence ? `${deal.buyerEvidence}\n${entry}` : entry;
    else deal.sellerEvidence = deal.sellerEvidence ? `${deal.sellerEvidence}\n${entry}` : entry;

    // A settlement proposal, if included, is recorded SEALED and FINAL. Sealed:
    // the number is kept out of the public ledger event and the snapshot, so the
    // counterparty can't anchor to it. Final: each party gets exactly one
    // proposal — otherwise a party could binary-search the counterparty's sealed
    // figure by probing the tolerance band across repeated submissions, then
    // land just inside it to skew the midpoint.
    let proposalRecorded = false;
    if (proposeBuyerBps !== undefined) {
      const existing = role === 'buyer' ? deal.buyerProposalBps : deal.sellerProposalBps;
      if (existing !== null) {
        dealLogger(dealId).warn({ role }, 'ignoring repeat settlement proposal — proposals are final');
        await this.safeSendDM(msg.senderPubkey, `Your sealed settlement proposal for ${dealId} is final; the new figure was ignored (your statement was still recorded).`);
      } else {
        if (role === 'buyer') deal.buyerProposalBps = proposeBuyerBps;
        else deal.sellerProposalBps = proposeBuyerBps;
        proposalRecorded = true;
      }
    }

    deal.updatedAt = Date.now();
    this.store.updateDeal(deal);
    this.store.addDealEvent(dealId, 'EVIDENCE', `${role} submitted evidence`);
    if (proposalRecorded) {
      this.store.addDealEvent(dealId, 'PROPOSAL', `${role} submitted a sealed settlement proposal`);
    }
    dealLogger(dealId).info({ role, proposed: proposalRecorded }, 'dispute evidence received');
    await this.safeSendDM(msg.senderPubkey, encodeMessage({ v: 1, type: 'deal.update', deal: this.snapshot(deal) }));

    // Both sides proposed a split: if they roughly agree, settle at the midpoint
    // with no arbiter — most disputes are a price haggle, not a lie. The numbers
    // are compared only now, once both are locked in.
    if (deal.buyerProposalBps !== null && deal.sellerProposalBps !== null) {
      const gap = Math.abs(deal.buyerProposalBps - deal.sellerProposalBps);
      if (gap <= config.disputeAutoSettleToleranceBps) {
        const midpoint = Math.round((deal.buyerProposalBps + deal.sellerProposalBps) / 2);
        dealLogger(dealId).info(
          { buyer: deal.buyerProposalBps, seller: deal.sellerProposalBps, midpoint },
          'proposals within tolerance — auto-settling at midpoint (no arbiter)',
        );
        return this.applyVerdict(
          deal,
          {
            buyerBps: midpoint,
            rationale: `Settled by agreement: both parties proposed splits within ${config.disputeAutoSettleToleranceBps / 100}% of each other (buyer ${deal.buyerProposalBps / 100}%, seller ${deal.sellerProposalBps / 100}%). No arbiter was required; the escrow is split at the midpoint.`,
            arbiter: 'agreement',
          },
          'AGREED',
        );
      }
      dealLogger(dealId).info(
        { buyer: deal.buyerProposalBps, seller: deal.sellerProposalBps },
        'proposals too far apart — escalating to the arbiter',
      );
    }

    // Both sides have now been heard — rule immediately instead of waiting.
    if (deal.buyerEvidence && deal.sellerEvidence) await this.resolveDispute(deal);
  }

  /** Run the arbiter on a disputed deal and apply its split verdict. */
  private async resolveDispute(deal: DealRow): Promise<void> {
    if (deal.state !== DealState.DISPUTED) return; // already resolved / raced
    dealLogger(deal.dealId).info('resolving dispute — invoking arbiter');
    const verdict = await judge({
      dealId: deal.dealId,
      deliverable: deal.deliverable,
      amount: deal.amount,
      symbol: deal.symbol ?? deal.coinId.slice(0, 8),
      deliveryProof: deal.proof,
      buyerEvidence: deal.buyerEvidence,
      sellerEvidence: deal.sellerEvidence,
    });
    await this.applyVerdict(deal, verdict, 'ARBITER_RULED');
  }

  /** Commit a settled verdict — from the arbiter, or from an agreed midpoint —
   *  as the RESOLVE transition, ledgering the buyer share and how it was reached. */
  private async applyVerdict(deal: DealRow, verdict: Verdict, event: string): Promise<void> {
    if (deal.state !== DealState.DISPUTED) return; // already resolved / raced
    this.store.addDealEvent(deal.dealId, event, `${verdict.arbiter}: buyer ${verdict.buyerBps / 100}% — ${verdict.rationale}`);
    const result = transition(deal, DealEvent.RESOLVE, verdict, Date.now(), machineCfg);
    if (result.ok) await this.commit(result.deal, DealEvent.RESOLVE, result.effects);
  }

  private async handleStatus(msg: DirectMessage, dealId: string): Promise<void> {
    const deal = this.store.getDeal(dealId);
    if (!deal) return this.replyError(msg.senderPubkey, ErrorCode.UNKNOWN_DEAL, `No deal ${dealId}.`, dealId);
    const isParty = msg.senderPubkey === deal.buyerPubkey || msg.senderPubkey === deal.sellerPubkey || (await this.authenticate(deal, msg, 'seller'));
    if (!isParty) return this.replyError(msg.senderPubkey, ErrorCode.NOT_YOUR_DEAL, 'Only deal parties can query status.', dealId);
    await this.safeSendDM(msg.senderPubkey, encodeMessage({ v: 1, type: 'deal.update', deal: this.snapshot(deal) }));
  }

  // ---------------------------------------------------------------------------
  // Marketplace offers — sellers list; the agent curates + mirrors to the market
  // ---------------------------------------------------------------------------

  private async handleOfferPost(msg: DirectMessage, m: OfferPost): Promise<void> {
    const shapeErr = validateDealShape(m);
    if (shapeErr) return this.replyError(msg.senderPubkey, ErrorCode.BAD_MESSAGE, shapeErr);

    const built = this.buildPlan(m.milestones, m.amount, m.deliverable, m.deliveryHours);
    if ('error' in built) return this.replyError(msg.senderPubkey, built.code, built.error);
    const { plan, totalAmount, active } = built;
    if (totalAmount < config.minEscrow || totalAmount > config.maxEscrow) {
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.AMOUNT_OUT_OF_RANGE,
        `Offer price must be between ${config.minEscrow} and ${config.maxEscrow} base units.`,
      );
    }

    const bySymbol = getCoinIdBySymbol(m.coinId);
    const coinId = bySymbol ?? m.coinId;
    const symbol = bySymbol ? m.coinId.toUpperCase() : (getTokenSymbol(coinId) || null);
    if (config.allowedCoins.length && !config.allowedCoins.includes(coinId) && !(symbol && config.allowedCoins.includes(symbol))) {
      return this.replyError(msg.senderPubkey, ErrorCode.UNSUPPORTED_COIN, `This notary escrows only: ${config.allowedCoins.join(', ')}`);
    }

    // The seller must be payable — an offer is only useful if a deal can settle to them.
    const sellerTag =
      msg.senderNametag ?? (await this.sphere.communications.resolvePeerNametag(msg.senderPubkey).catch(() => undefined));
    if (!sellerTag) {
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.UNRESOLVABLE_PARTY,
        'You need a registered nametag to post an offer — buyers pay deals out to it. Register one and retry.',
      );
    }

    if (this.store.countOpenOffersBySeller(msg.senderPubkey) >= config.maxOpenOffersPerSeller) {
      return this.replyError(
        msg.senderPubkey,
        ErrorCode.BAD_MESSAGE,
        `You already have the maximum ${config.maxOpenOffersPerSeller} open offers. Close one before posting another.`,
      );
    }

    const now = Date.now();
    const ttlDays = m.expiresInDays ?? config.offerTtlDays;
    const offer: OfferRow = {
      offerId: `offer_${randomUUID().slice(0, 8)}`,
      sellerPubkey: msg.senderPubkey,
      sellerTag: sellerTag.toLowerCase(),
      title: m.title,
      deliverable: active.deliverable,
      amount: totalAmount.toString(),
      coinId,
      symbol,
      deliveryHours: active.deliveryHours,
      milestonesJson: plan ? JSON.stringify(plan.map((p) => ({ amount: p.amount, deliverable: p.deliverable, deliveryHours: p.deliveryHours }))) : null,
      marketIntentId: null,
      status: 'open',
      createdAt: now,
      expiresAt: now + ttlDays * 86_400_000,
      updatedAt: now,
    };

    // Best-effort mirror to the signed-intent market so other agents can discover it.
    // A market outage must never block a local listing.
    try {
      const market = this.sphere.market;
      if (market) {
        const res = await market.postIntent({
          intentType: 'sell',
          category: 'notary-offer',
          description:
            `${m.title} — offered by @${offer.sellerTag} via @${config.nametag} escrow. ` +
            `${active.deliverable} Price ${offer.amount} ${symbol ?? coinId.slice(0, 8)}` +
            `${plan ? ` across ${plan.length} milestones` : ''}. Open an escrowed deal with @${config.nametag}. ` +
            `[notary-offer]${JSON.stringify({ v: 1, offerId: offer.offerId, seller: offer.sellerTag })}`,
          currency: symbol ?? config.preferredCoin,
          contactHandle: `@${config.nametag}`,
          expiresInDays: ttlDays,
        });
        offer.marketIntentId = res.intentId;
      }
    } catch (err) {
      logger.warn({ err, offerId: offer.offerId }, 'offer market mirror failed (listing still saved locally)');
    }

    this.store.insertOffer(offer);
    this.store.addLedger('offer_posted', { offerId: offer.offerId, seller: offer.sellerTag, amount: offer.amount, marketIntentId: offer.marketIntentId });
    logger.info({ offerId: offer.offerId, seller: offer.sellerTag, marketIntentId: offer.marketIntentId }, 'offer posted');
    await this.safeSendDM(
      msg.senderPubkey,
      encodeMessage({ v: 1, type: 'offer.posted', offerId: offer.offerId, marketIntentId: offer.marketIntentId ?? undefined }),
    );
  }

  private async handleOfferClose(msg: DirectMessage, offerId: string): Promise<void> {
    const offer = this.store.getOffer(offerId);
    if (!offer) return this.replyError(msg.senderPubkey, ErrorCode.UNKNOWN_DEAL, `No offer ${offerId}.`);
    // Only the seller who posted it may close it (authenticated by transport pubkey).
    if (offer.sellerPubkey !== msg.senderPubkey) {
      return this.replyError(msg.senderPubkey, ErrorCode.NOT_YOUR_DEAL, `Offer ${offerId} is not yours to close.`);
    }
    if (offer.status !== 'open') {
      return this.safeSendDM(msg.senderPubkey, `Offer ${offerId} is already ${offer.status}.`);
    }
    this.closeOffer(offer, 'closed');
    await this.safeSendDM(msg.senderPubkey, `Offer ${offerId} closed. It is no longer listed.`);
  }

  /** Mark an offer closed/expired and best-effort remove its market mirror.
   *  The local DB is updated FIRST and synchronously; the market close is fired
   *  without awaiting so a slow/hanging market API can never block the caller —
   *  crucial because this runs on the single serialized actor chain that also
   *  processes every deal DM and timeout. */
  private closeOffer(offer: OfferRow, status: 'closed' | 'expired'): void {
    offer.status = status;
    offer.updatedAt = Date.now();
    this.store.updateOffer(offer);
    this.store.addLedger('offer_closed', { offerId: offer.offerId, status });
    if (offer.marketIntentId && this.sphere.market) {
      void this.sphere.market
        .closeIntent(offer.marketIntentId)
        .catch((err) => logger.warn({ err, offerId: offer.offerId }, 'market closeIntent failed'));
    }
  }

  /** Retire offers whose TTL lapsed. Called from the timer tick; never throws so
   *  it can't wedge deal-timeout processing. */
  private expireOffers(now: number): void {
    try {
      for (const offer of this.store.expiredOpenOffers(now)) {
        this.closeOffer(offer, 'expired');
        logger.info({ offerId: offer.offerId }, 'offer expired');
      }
    } catch (err) {
      logger.warn({ err }, 'expireOffers failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Transition commit + effects
  // ---------------------------------------------------------------------------

  private async commit(deal: DealRow, event: DealEvent, effects: Effect[]): Promise<void> {
    const log = dealLogger(deal.dealId);
    this.store.updateDeal(deal);
    this.store.addDealEvent(deal.dealId, event, `→ ${deal.state}`);
    log.info({ event, state: deal.state }, 'transition committed');

    for (const effect of effects) {
      switch (effect.type) {
        case 'send_payment_request':
          await this.sendFundingRequest(deal);
          break;
        case 'payout': {
          const id = this.store.insertPayout({
            dealId: deal.dealId,
            poolId: null,
            kind: effect.kind,
            recipient: effect.recipient === 'buyer' ? `@${deal.buyerTag}` : `@${deal.sellerTag}`,
            amount: effect.amount.toString(),
            coinId: deal.coinId,
            memo: effect.memo,
            status: 'pending',
            transferId: null,
            attempts: 0,
            lastError: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          this.store.addDealEvent(deal.dealId, 'PAYOUT_QUEUED', `${effect.kind} ${effect.amount} → ${effect.recipient} (payout #${id})`);
          break;
        }
        case 'notify':
          if (effect.audience !== 'seller') await this.dmBuyer(deal, effect.text);
          if (effect.audience !== 'buyer') await this.dmSeller(deal, effect.text);
          break;
      }
    }

    // Settlements execute immediately, not on the 30s tick.
    await this.runPayoutExecutor();
    await this.broadcastUpdate(this.store.getDeal(deal.dealId) ?? deal);
  }

  private async sendFundingRequest(deal: DealRow): Promise<void> {
    const res = await withRetry(
      () =>
        this.sphere.payments.sendPaymentRequest(`@${deal.buyerTag}`, {
          amount: deal.amount,
          coinId: deal.coinId,
          message: `Escrow funding for deal ${deal.dealId}: "${deal.deliverable.slice(0, 120)}"`,
          metadata: { dealId: deal.dealId, notary: config.nametag },
        }),
      { attempts: 4, onRetry: (err, n) => dealLogger(deal.dealId).warn({ err, attempt: n }, 'payment request retry') },
    );
    if (!res.success || !res.requestId) throw new Error(`payment request failed: ${res.error ?? 'unknown'}`);
    deal.paymentRequestId = res.requestId;
    this.store.updateDeal(deal);
    this.store.addDealEvent(deal.dealId, 'PAYMENT_REQUESTED', `requestId ${res.requestId}`);
    dealLogger(deal.dealId).info({ requestId: res.requestId }, 'funding payment request sent to buyer');
  }

  // ---------------------------------------------------------------------------
  // Funding verification: 'paid' response is a claim — confirm the money landed.
  // ---------------------------------------------------------------------------

  private async onPaymentResponse(res: PaymentRequestResponse): Promise<void> {
    if (res.responseType === 'rejected') {
      const deal = this.store.getDealByPaymentRequest(res.requestId);
      if (deal && deal.state === DealState.AWAITING_FUNDS) {
        this.store.addDealEvent(deal.dealId, 'FUNDING_REJECTED', 'buyer rejected the payment request; funding timer keeps running');
        await this.dmBuyer(deal, `You rejected the funding request for ${deal.dealId}. The deal expires at ${new Date(deal.deadlineAt!).toISOString()} unless funded.`);
      }
      return;
    }
    if (res.responseType !== 'paid') return;
    const deal = this.store.getDealByPaymentRequest(res.requestId);
    if (!deal) return; // pool contributions are handled by PoolService
    if (deal.state !== DealState.AWAITING_FUNDS) return; // replay — idempotent
    const log = dealLogger(deal.dealId);
    log.info({ transferId: res.transferId }, "buyer claims 'paid' — verifying the transfer landed");

    const landed = await this.waitForIncoming(deal);
    if (!landed) {
      log.warn('paid response received but no matching incoming transfer yet — will re-verify on timer ticks');
      this.store.addDealEvent(deal.dealId, 'FUNDING_UNVERIFIED', `paid response (transferId ${res.transferId ?? '?'}) awaiting on-chain arrival`);
      return;
    }
    const result = transition(deal, DealEvent.FUNDS_RECEIVED, { transferId: landed }, Date.now(), machineCfg);
    if (result.ok) await this.commit(result.deal, DealEvent.FUNDS_RECEIVED, result.effects);
  }

  /**
   * Confirm escrow arrival: a RECEIVED history entry for this coin, amount >=
   * the deal amount, newer than the deal, and not already claimed by another
   * deal. Prefers entries whose memo names the dealId.
   */
  private findIncoming(deal: DealRow): string | null {
    const history = this.sphere.payments.getHistory();
    const candidates = history.filter(
      (h) =>
        h.type === 'RECEIVED' &&
        h.coinId === deal.coinId &&
        BigInt(h.amount) >= BigInt(deal.amount) &&
        h.timestamp >= deal.createdAt - 60_000 &&
        this.store.getKV(`claimed:${h.dedupKey}`) === null,
    );
    const pick = candidates.find((h) => h.memo?.includes(deal.dealId)) ?? candidates[0];
    if (!pick) return null;
    this.store.setKV(`claimed:${pick.dedupKey}`, deal.dealId);
    return pick.transferId ?? pick.dedupKey;
  }

  private async waitForIncoming(deal: DealRow, tries = 15, delayMs = 2_000): Promise<string | null> {
    for (let i = 0; i < tries; i++) {
      const hit = this.findIncoming(deal);
      if (hit) return hit;
      // Nudge the mailbox — incoming deliveries also arrive via background poll.
      await this.sphere.payments.pumpIncomingDeliveries().catch(() => 0);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Timers — deadlines persisted in SQLite; this loop just reads the clock.
  // ---------------------------------------------------------------------------

  private async tickTimers(): Promise<void> {
    const now = Date.now();
    this.expireOffers(now);
    for (const deal of this.store.dealsWithExpiredTimers(now)) {
      if (TERMINAL_STATES.has(deal.state)) continue;

      // A disputed deal's window has lapsed — the arbiter rules on whatever
      // evidence exists. This is async (an AI call), so it's not a pure
      // machine timeout; resolveDispute handles the RESOLVE transition itself.
      if (deal.state === DealState.DISPUTED) {
        dealLogger(deal.dealId).info('dispute window lapsed — ruling on submitted evidence');
        await this.resolveDispute(deal);
        continue;
      }

      // A deal can sit AWAITING_FUNDS with a verified-late transfer: re-check
      // funding one last time before expiring it.
      if (deal.state === DealState.AWAITING_FUNDS) {
        const landed = this.findIncoming(deal);
        if (landed) {
          const r = transition(deal, DealEvent.FUNDS_RECEIVED, { transferId: landed }, now, machineCfg);
          if (r.ok) {
            await this.commit(r.deal, DealEvent.FUNDS_RECEIVED, r.effects);
            continue;
          }
        }
      }

      const event = TIMEOUT_EVENT_FOR_STATE[deal.state];
      if (!event) continue;
      dealLogger(deal.dealId).info({ state: deal.state, event }, 'deadline lapsed — autonomous transition');
      const result = transition(deal, event, {}, now, machineCfg);
      if (result.ok) await this.commit(result.deal, event, result.effects);
    }
  }

  // ---------------------------------------------------------------------------
  // Payout executor — the only place agent money leaves the wallet.
  // ---------------------------------------------------------------------------

  private payoutRunning = false;

  async runPayoutExecutor(): Promise<void> {
    if (this.payoutRunning) return;
    this.payoutRunning = true;
    try {
      for (const p of this.store.pendingPayouts()) {
        if (p.status === 'unconfirmed') continue; // owned by resumeOpenIntents()
        await this.executePayout(p);
      }
    } finally {
      this.payoutRunning = false;
    }
  }

  private async executePayout(p: PayoutRow): Promise<void> {
    const log = logger.child({ payout: p.id, dealId: p.dealId ?? p.poolId });
    p.attempts += 1;
    p.updatedAt = Date.now();
    try {
      const result = await this.sphere.payments.send({
        recipient: p.recipient,
        amount: p.amount,
        coinId: p.coinId,
        memo: p.memo,
      });
      p.status = 'sent';
      p.transferId = result.id;
      p.lastError = null;
      this.store.updatePayout(p);
      if (p.dealId) this.store.addDealEvent(p.dealId, 'PAYOUT_SENT', `${p.kind} ${p.amount} → ${p.recipient} (transfer ${result.id}${result.deliveryPending ? ', delivery pending — certified on-chain' : ''})`);
      this.store.addLedger('payout', { id: p.id, dealId: p.dealId, poolId: p.poolId, kind: p.kind, recipient: p.recipient, amount: p.amount, coinId: p.coinId, transferId: result.id });
      log.info({ transferId: result.id, deliveryPending: result.deliveryPending ?? false }, 'payout sent');
    } catch (err) {
      if (isSphereError(err) && err.code === 'CERTIFICATION_UNCONFIRMED') {
        // May already be on-chain. NEVER re-send — resumeOpenIntents() completes
        // it under the same transferId. Mark and step aside.
        p.status = 'unconfirmed';
        p.lastError = 'CERTIFICATION_UNCONFIRMED (resume will complete it)';
        this.store.updatePayout(p);
        if (p.dealId) this.store.addDealEvent(p.dealId, 'PAYOUT_UNCONFIRMED', 'spend may be on-chain; resuming under original transferId');
        log.warn('payout certification unconfirmed — deferred to intent resume');
        return;
      }
      const permanent = isSphereError(err) && (err.code === 'INVALID_RECIPIENT' || err.code === 'INVALID_CONFIG');
      const exhausted = p.attempts >= 8;
      p.lastError = err instanceof Error ? err.message : String(err);
      p.status = permanent || exhausted ? 'failed' : 'pending';
      this.store.updatePayout(p);
      log.error({ err, attempts: p.attempts, permanent }, 'payout attempt failed');
      if (p.status === 'failed' && p.dealId) {
        this.store.addDealEvent(p.dealId, 'PAYOUT_FAILED', `${p.kind} → ${p.recipient}: ${p.lastError}`);
        const deal = this.store.getDeal(p.dealId);
        if (deal) await this.dmBuyer(deal, `Settlement transfer for ${p.dealId} failed permanently (${p.lastError}). The operator has been alerted; funds remain safe in escrow.`);
      }
    }
  }

  private async resumeIntents(): Promise<void> {
    try {
      const res = await this.sphere.payments.resumeOpenIntents();
      if (res.resumed.length > 0 || res.conflicted.length > 0) {
        logger.info(res, 'open intents resumed');
        // Whatever was in-doubt is now settled under its original transferId.
        for (const p of this.store.pendingPayouts()) {
          if (p.status === 'unconfirmed') {
            p.status = 'sent';
            p.lastError = 'completed via resumeOpenIntents';
            p.updatedAt = Date.now();
            this.store.updatePayout(p);
            if (p.dealId) this.store.addDealEvent(p.dealId, 'PAYOUT_RESUMED', 'unconfirmed spend completed under original transferId');
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'resumeOpenIntents failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshots & messaging
  // ---------------------------------------------------------------------------

  snapshot(deal: DealRow): DealSnapshot {
    return {
      dealId: deal.dealId,
      state: deal.state,
      buyer: deal.buyerPubkey,
      seller: deal.sellerPubkey ?? '',
      buyerTag: deal.buyerTag,
      sellerTag: deal.sellerTag,
      amount: deal.amount,
      coinId: deal.coinId,
      symbol: deal.symbol ?? undefined,
      feeBps: deal.feeBps,
      deliverable: deal.deliverable,
      deliveryHours: deal.deliveryHours,
      createdAt: deal.createdAt,
      deadlineAt: deal.deadlineAt,
      milestones: deal.milestonesJson
        ? (JSON.parse(deal.milestonesJson) as MilestonePlanEntry[]).map(
            (mm): MilestoneStateEntry => ({
              index: mm.index,
              amount: mm.amount,
              deliverable: mm.deliverable,
              deliveryHours: mm.deliveryHours,
              state: mm.state,
              settlement: mm.settlement,
            }),
          )
        : undefined,
      currentMilestone: deal.currentMilestone ?? undefined,
      totalAmount: deal.totalAmount,
      settlement: deal.settlementJson
        ? { ...JSON.parse(deal.settlementJson), transferIds: this.store.payoutsForDeal(deal.dealId).map((p) => p.transferId).filter((t): t is string => t !== null) }
        : undefined,
      dispute:
        deal.buyerEvidence || deal.sellerEvidence || deal.verdictJson
          ? {
              reason: deal.buyerEvidence ?? undefined,
              buyerEvidence: deal.buyerEvidence ?? undefined,
              sellerEvidence: deal.sellerEvidence ?? undefined,
              verdict: deal.verdictJson ? JSON.parse(deal.verdictJson) : undefined,
            }
          : undefined,
      events: this.store.getDealEvents(deal.dealId).map((e) => ({ at: e.at, event: e.event, detail: e.detail ?? undefined })),
    };
  }

  /** deal.update to both parties — the web app's live channel. */
  private async broadcastUpdate(deal: DealRow): Promise<void> {
    const payload = encodeMessage({ v: 1, type: 'deal.update', deal: this.snapshot(deal) });
    await this.safeSendDM(deal.buyerPubkey, payload);
    await this.safeSendDM(deal.sellerPubkey ?? `@${deal.sellerTag}`, payload);
  }

  private dmBuyer(deal: DealRow, text: string): Promise<void> {
    return this.safeSendDM(deal.buyerPubkey, text);
  }
  private dmSeller(deal: DealRow, text: string): Promise<void> {
    return this.safeSendDM(deal.sellerPubkey ?? `@${deal.sellerTag}`, text);
  }

  private async safeSendDM(recipient: string, content: string): Promise<void> {
    if (!recipient) return;
    try {
      await withRetry(() => this.sphere.communications.sendDM(recipient, content), { attempts: 3, baseMs: 500 });
    } catch (err) {
      logger.warn({ err, recipient: recipient.slice(0, 16) }, 'DM send failed (gave up)');
    }
  }

  private async replyError(to: string, code: ErrorCode, message: string, dealId?: string): Promise<void> {
    const err: NotaryMessage = { v: 1, type: 'error', code, message, dealId };
    await this.safeSendDM(to, encodeMessage(err));
  }
}
