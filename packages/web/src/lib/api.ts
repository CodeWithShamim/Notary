import { AGENT_API } from './sphere.js';

export interface AgentStatus {
  service: string;
  protocolVersion: number;
  identity: { nametag: string | null; directAddress: string | null; chainPubkey: string | null };
  online: boolean;
  uptimeSec: number;
  feeBps: number;
  disputeFeeBps: number;
  dealsByState: Record<string, number>;
  escrowVolume: { coinId: string; symbol: string | null; total: string }[];
  pools: { poolId: string; status: string; purpose: string; amountEach: string; symbol: string; contributors: number; joined: number; deadlineAt: number }[];
  treasury: { assets: { coinId: string; symbol: string; total: string; decimals: number }[]; lastRun: number | null };
  lastRebalance: Record<string, unknown> | null;
  timers: { acceptTimeoutMs: number; fundingTimeoutMs: number; defaultDeliveryHours: number; confirmTimeoutMs: number };
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
export const fetchPools = (): Promise<{ pools: AgentStatus['pools'] & { pot?: string }[] }> => get('/api/pools');
