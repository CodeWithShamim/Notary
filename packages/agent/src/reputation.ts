/**
 * Reputation is derived, not stored: it aggregates the append-only deal history
 * into a per-nametag track record. Because every party is a registered nametag
 * and every settlement is recorded, this is trustworthy without any extra input.
 *
 * REFUNDED = the seller ghosted a funded deal (delivery timeout). RESOLVED = a
 * deal that went to arbitration. RELEASED = clean completion.
 */
import { DealState } from '@notary/shared';
import type { ReputationDealRow } from './db.js';

export interface Reputation {
  tag: string;
  dealsAsBuyer: number;
  dealsAsSeller: number;
  completed: number; //  seller side, RELEASED
  disputed: number; //   seller side, RESOLVED (went to arbitration)
  ghosted: number; //    seller side, REFUNDED (missed delivery window)
  /** completed / (completed + disputed + ghosted); null when no finished sales. */
  completionRate: number | null;
  volumeSettled: { symbol: string; total: string }[];
  firstSeen: number | null;
  lastActive: number | null;
}

const norm = (t: string): string => t.replace(/^@/, '').toLowerCase();

export function computeReputation(rows: ReputationDealRow[], tag: string): Reputation {
  const want = norm(tag);
  const rep: Reputation = {
    tag: want,
    dealsAsBuyer: 0,
    dealsAsSeller: 0,
    completed: 0,
    disputed: 0,
    ghosted: 0,
    completionRate: null,
    volumeSettled: [],
    firstSeen: null,
    lastActive: null,
  };

  const volume = new Map<string, { symbol: string; total: bigint }>();

  for (const r of rows) {
    const isBuyer = norm(r.buyerTag) === want;
    const isSeller = norm(r.sellerTag) === want;
    if (!isBuyer && !isSeller) continue;

    rep.firstSeen = rep.firstSeen === null ? r.createdAt : Math.min(rep.firstSeen, r.createdAt);
    rep.lastActive = rep.lastActive === null ? r.updatedAt : Math.max(rep.lastActive, r.updatedAt);

    if (isBuyer) rep.dealsAsBuyer += 1;
    if (isSeller) {
      rep.dealsAsSeller += 1;
      if (r.state === DealState.RELEASED) rep.completed += 1;
      else if (r.state === DealState.RESOLVED) rep.disputed += 1;
      else if (r.state === DealState.REFUNDED) rep.ghosted += 1;
    }

    // Settled volume: money that actually moved on this party's behalf.
    if (r.state === DealState.RELEASED || r.state === DealState.RESOLVED) {
      const sym = r.symbol ?? r.coinId.slice(0, 8);
      const cur = volume.get(r.coinId) ?? { symbol: sym, total: 0n };
      cur.total += BigInt(r.amount);
      volume.set(r.coinId, cur);
    }
  }

  const finishedSales = rep.completed + rep.disputed + rep.ghosted;
  rep.completionRate = finishedSales > 0 ? rep.completed / finishedSales : null;
  rep.volumeSettled = [...volume.values()].map((v) => ({ symbol: v.symbol, total: v.total.toString() }));
  return rep;
}

/** Leaderboard: reputation for every nametag that has ever transacted, busiest first. */
export function computeLeaderboard(rows: ReputationDealRow[]): Reputation[] {
  const tags = new Set<string>();
  for (const r of rows) {
    if (r.buyerTag) tags.add(norm(r.buyerTag));
    if (r.sellerTag) tags.add(norm(r.sellerTag));
  }
  return [...tags]
    .map((t) => computeReputation(rows, t))
    .sort((a, b) => b.dealsAsBuyer + b.dealsAsSeller - (a.dealsAsBuyer + a.dealsAsSeller));
}
