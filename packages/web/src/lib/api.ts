import type { Offer } from '@notary/shared';
import { AGENT_API } from './sphere.js';

export interface AgentStatus {
  service: string;
  protocolVersion: number;
  identity: { nametag: string | null; directAddress: string | null; chainPubkey: string | null };
  online: boolean;
  uptimeSec: number;
  feeBps: number;
  disputeFeeBps: number;
  arbiter: { mode: 'ai' | 'rule'; model: string | null; disputeWindowMs: number };
  dealsByState: Record<string, number>;
  escrowVolume: { coinId: string; symbol: string | null; total: string }[];
  pools: { poolId: string; status: string; purpose: string; amountEach: string; symbol: string; contributors: number; joined: number; deadlineAt: number }[];
  treasury: { assets: { coinId: string; symbol: string; total: string; decimals: number }[]; lastRun: number | null };
  lastRebalance: Record<string, unknown> | null;
  timers: { acceptTimeoutMs: number; fundingTimeoutMs: number; defaultDeliveryHours: number; confirmTimeoutMs: number };
}

export interface Pool {
  poolId: string;
  status: 'open' | 'paid_out' | 'cancelled' | 'expired';
  purpose: string;
  amountEach: string;
  coinId: string;
  symbol?: string;
  contributors: number;
  joined: number;
  pot: string;
  deadlineAt: number;
  createdAt: number;
}

export interface Reputation {
  tag: string;
  dealsAsBuyer: number;
  dealsAsSeller: number;
  completed: number;
  disputed: number;
  ghosted: number;
  completionRate: number | null;
  volumeSettled: { symbol: string; total: string }[];
  firstSeen: number | null;
  lastActive: number | null;
}

export interface DealTrail {
  dealId: string;
  state: string;
  amount: string;
  symbol?: string;
  coinId: string;
  feeBps: number;
  createdAt: number;
  deadlineAt: number | null;
  events: { at: number; event: string; detail?: string }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${AGENT_API}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchStatus = (): Promise<AgentStatus> => get('/api/status');
export const fetchDealTrail = (dealId: string): Promise<DealTrail> => get(`/api/deals/${dealId}/events`);
export const fetchProtocol = (): Promise<Record<string, unknown>> => get('/api/protocol');
export const fetchPools = (): Promise<{ pools: Pool[] }> => get('/api/pools');
export const fetchLeaderboard = (): Promise<{ reputations: Reputation[] }> => get('/api/reputation');
export const fetchReputation = (tag: string): Promise<Reputation> => get(`/api/reputation/${encodeURIComponent(tag.replace(/^@/, ''))}`);
export const fetchOffers = (): Promise<{ offers: Offer[] }> => get('/api/offers');
export const fetchOffer = (offerId: string): Promise<Offer> => get(`/api/offers/${encodeURIComponent(offerId)}`);
