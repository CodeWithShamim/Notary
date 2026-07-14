import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Sphere } from '@unicitylabs/sphere-sdk';
import { DealState, DealEvent, HELP_TEXT, LEGAL_TRANSITIONS, PROTOCOL_VERSION } from '@notary/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import { computeLeaderboard, computeReputation } from './reputation.js';
import type { OfferRow, Store } from './db.js';
import type { Treasury } from './treasury.js';

const STARTED_AT = Date.now();

/** Strip nametags/pubkeys from event details — the API trail is public. */
function redact(detail: string | null): string | undefined {
  if (!detail) return undefined;
  return detail.replace(/@[a-z0-9_+-]+/gi, '@…').replace(/\b[0-9a-f]{16,}\b/gi, '…');
}

/** Public shape of an offer for the marketplace API. `sellerTag` is intentionally
 *  exposed here (unlike the private deal trail) — an offer is a public listing. */
function offerToJson(o: OfferRow) {
  return {
    offerId: o.offerId,
    sellerTag: o.sellerTag,
    title: o.title,
    deliverable: o.deliverable,
    amount: o.amount,
    coinId: o.coinId,
    symbol: o.symbol ?? undefined,
    deliveryHours: o.deliveryHours,
    milestones: o.milestonesJson ? (JSON.parse(o.milestonesJson) as unknown[]) : undefined,
    status: o.status,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
  };
}

/**
 * Read-only sidecar. There are deliberately NO write endpoints: every state
 * change happens over the network (DMs / payment requests / group chat) —
 * that is the product.
 */
export async function startApi(sphere: Sphere, store: Store, treasury: Treasury): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get('/api/status', async () => {
    const t = await treasury.summary();
    const lastRebalance = store
      .recentLedger(200)
      .find((l) => l.kind === 'treasury_rebalance_intent');
    return {
      service: 'notary',
      protocolVersion: PROTOCOL_VERSION,
      identity: {
        nametag: sphere.identity?.nametag ?? null,
        directAddress: sphere.identity?.directAddress ?? null,
        chainPubkey: sphere.identity?.chainPubkey ?? null,
      },
      online: true,
      uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
      feeBps: config.feeBps,
      disputeFeeBps: config.disputeFeeBps,
      arbiter: {
        mode: config.anthropicApiKey ? 'ai' : 'rule',
        model: config.anthropicApiKey ? config.arbiterModel : null,
        disputeWindowMs: config.disputeWindowMs,
      },
      dealsByState: store.countDealsByState(),
      escrowVolume: store.totalVolume(),
      pools: store.listPools().map((p) => ({
        poolId: p.poolId,
        status: p.status,
        purpose: p.purpose,
        amountEach: p.amountEach,
        symbol: p.symbol ?? p.coinId.slice(0, 8),
        contributors: store.getPoolMembers(p.poolId).filter((m) => m.paid).length,
        joined: store.getPoolMembers(p.poolId).length,
        deadlineAt: p.deadlineAt,
      })),
      treasury: t,
      lastRebalance: lastRebalance ? { at: lastRebalance.at, ...JSON.parse(lastRebalance.detail) } : null,
      timers: {
        acceptTimeoutMs: config.acceptTimeoutMs,
        fundingTimeoutMs: config.fundingTimeoutMs,
        defaultDeliveryHours: config.defaultDeliveryHours,
        confirmTimeoutMs: config.confirmTimeoutMs,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/api/deals/:id/events', async (req, reply) => {
    const deal = store.getDeal(req.params.id);
    if (!deal) return reply.code(404).send({ error: 'unknown deal' });
    return {
      dealId: deal.dealId,
      state: deal.state,
      amount: deal.amount,
      symbol: deal.symbol ?? undefined,
      coinId: deal.coinId,
      feeBps: deal.feeBps,
      createdAt: deal.createdAt,
      deadlineAt: deal.deadlineAt,
      // Public trail: terms (deliverable, party identities) stay private to the
      // parties' DM channel; the DM deal.update snapshots carry the full data.
      events: store.getDealEvents(deal.dealId).map((e) => ({ at: e.at, event: e.event, detail: redact(e.detail) })),
    };
  });

  // Marketplace: open seller offers. Public by design — a listing exists to be
  // discovered. Buyers open a deal from one; the deal still runs full validation.
  app.get('/api/offers', async () => ({
    offers: store.listOpenOffers().map((o) => offerToJson(o)),
  }));

  app.get<{ Params: { id: string } }>('/api/offers/:id', async (req, reply) => {
    const offer = store.getOffer(req.params.id);
    if (!offer) return reply.code(404).send({ error: 'unknown offer' });
    return offerToJson(offer);
  });

  app.get('/api/pools', async () => ({
    pools: store.listPools().map((p) => {
      const members = store.getPoolMembers(p.poolId);
      return {
        poolId: p.poolId,
        status: p.status,
        purpose: p.purpose,
        amountEach: p.amountEach,
        coinId: p.coinId,
        symbol: p.symbol ?? undefined,
        contributors: members.filter((m) => m.paid).length,
        joined: members.length,
        pot: (BigInt(p.amountEach) * BigInt(members.filter((m) => m.paid).length)).toString(),
        deadlineAt: p.deadlineAt,
        createdAt: p.createdAt,
      };
    }),
  }));

  // Reputation: derived per-nametag track record. Leaderboard + single lookup.
  app.get('/api/reputation', async () => ({
    reputations: computeLeaderboard(store.reputationRows()).slice(0, 100),
  }));

  app.get<{ Params: { tag: string } }>('/api/reputation/:tag', async (req) => {
    return computeReputation(store.reputationRows(), req.params.tag);
  });

  app.get('/api/protocol', async () => ({
    protocolVersion: PROTOCOL_VERSION,
    transport: 'NIP-17 encrypted DM to @' + config.nametag + ' (JSON body)',
    states: Object.values(DealState),
    events: Object.values(DealEvent),
    transitions: LEGAL_TRANSITIONS,
    fees: { escrowBps: config.feeBps, disputeBps: config.disputeFeeBps },
    limits: { minEscrow: config.minEscrow.toString(), maxEscrow: config.maxEscrow.toString() },
    timersMs: {
      accept: config.acceptTimeoutMs,
      funding: config.fundingTimeoutMs,
      deliveryDefaultHours: config.defaultDeliveryHours,
      confirm: config.confirmTimeoutMs,
      disputeWindow: config.disputeWindowMs,
    },
    messages: {
      'deal.open': { direction: 'buyer → notary', fields: { seller: '@nametag', amount: 'base-unit string (single deal)', coinId: 'hex coinId or registry symbol', deliverable: 'string (single deal)', deliveryHours: 'int, optional', milestones: 'array of {amount, deliverable, deliveryHours?} for staged escrow — mutually exclusive with amount+deliverable' } },
      'deal.invite': { direction: 'notary → seller', fields: { dealId: '', buyer: '', seller: '', amount: '', coinId: '', deliverable: '', deliveryHours: '', feeBps: '', acceptBy: 'unix ms' } },
      'deal.accept': { direction: 'seller → notary', fields: { dealId: '' } },
      'deal.reject': { direction: 'seller → notary', fields: { dealId: '', reason: 'optional' } },
      'deal.funded': { direction: 'notary → parties', fields: { dealId: '', amount: '', coinId: '', deliverBy: 'unix ms' } },
      'deal.delivered': { direction: 'seller → notary', fields: { dealId: '', proof: 'optional URL/hash' } },
      'deal.confirm': { direction: 'buyer → notary', fields: { dealId: '' } },
      'deal.dispute': { direction: 'buyer → notary', fields: { dealId: '', reason: 'optional' } },
      'deal.evidence': { direction: 'party → notary', fields: { dealId: '', statement: 'string', proof: 'optional URL/hash' } },
      'deal.status': { direction: 'party → notary', fields: { dealId: '' } },
      'deal.update': { direction: 'notary → parties', fields: { deal: 'full DealSnapshot (see @notary/shared)' } },
      'offer.post': { direction: 'seller → notary', fields: { title: '', amount: 'base-unit string OR milestones[]', coinId: '', deliverable: '', deliveryHours: 'optional', expiresInDays: 'optional' } },
      'offer.close': { direction: 'seller → notary', fields: { offerId: '' } },
      'offer.posted': { direction: 'notary → seller', fields: { offerId: '', marketIntentId: 'optional' } },
      error: { direction: 'notary → sender', fields: { code: '', message: '', dealId: 'optional' } },
    },
    groupCommands: ['!pool create <amount-each> <coin> <purpose>', '!pool join <id>', '!pool status <id>', '!pool payout <id> @recipient', '!pool cancel <id>'],
    help: HELP_TEXT,
  }));

  await app.listen({ port: config.apiPort, host: config.apiHost });
  logger.info({ port: config.apiPort }, 'public API listening (read-only)');
  return app;
}
