import 'dotenv/config';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`env ${name} must be an integer, got ${raw}`);
  }
  return n;
}

function big(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`env ${name} must be integer base units, got ${raw}`);
  return BigInt(raw);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

const HOUR = 3_600_000;

export const config = {
  // identity ---------------------------------------------------------------
  /** The testnet2 gateway key is PUBLIC (published in the SDK README) — not a secret.
   *  A mainnet key WOULD be a secret; never default one here. */
  apiKey: process.env.UNICITY_API_KEY ?? 'sk_ddc3cfcc001e4a28ac3fad7407f99590',
  network: 'testnet' as const, // SDK alias for testnet2 (v2 gateway, networkId 4)
  walletApiUrl: process.env.WALLET_API_URL ?? 'https://wallet-api.unicity.network',
  dataDir: process.env.DATA_DIR ?? './wallet-data',
  dbPath: process.env.DB_PATH ?? './notary.db',
  /** Optional fixed mnemonic; otherwise FileStorageProvider persists the generated one. */
  mnemonic: process.env.WALLET_MNEMONIC || undefined,
  nametag: process.env.NOTARY_NAMETAG ?? 'notary',
  extraRelays: (process.env.EXTRA_RELAYS ?? '').split(',').filter(Boolean),

  // fees (basis points) ------------------------------------------------------
  feeBps: int('FEE_BPS', 100), //           1% escrow fee
  disputeFeeBps: int('DISPUTE_FEE_BPS', 50), // 0.5% retained on disputed refunds

  // escrow limits (base units; UCT has 18 decimals so 1 UCT = 1e18) -----------
  minEscrow: big('MIN_ESCROW', 1n),
  maxEscrow: big('MAX_ESCROW', 10n ** 24n), // up to ~1,000,000 UCT
  /** Coins the notary escrows. Empty = any coin resolvable in the registry. */
  allowedCoins: (process.env.ALLOWED_COINS ?? '').split(',').filter(Boolean),

  // timers -------------------------------------------------------------------
  acceptTimeoutMs: int('ACCEPT_TIMEOUT_MS', 1 * HOUR),
  fundingTimeoutMs: int('FUNDING_TIMEOUT_MS', 24 * HOUR),
  defaultDeliveryHours: int('DEFAULT_DELIVERY_HOURS', 72),
  confirmTimeoutMs: int('CONFIRM_TIMEOUT_MS', 48 * HOUR),
  timerPollMs: int('TIMER_POLL_MS', 15_000),

  // treasury (base units; 1 UCT = 1e18) --------------------------------------
  treasuryFloor: big('TREASURY_FLOOR', 10n ** 18n), //        self-mint below 1 UCT
  treasuryMintAmount: big('TREASURY_MINT_AMOUNT', 10n ** 19n), // mint 10 UCT
  treasuryThreshold: big('TREASURY_THRESHOLD', 10n ** 20n), // rebalance non-preferred above 100 UCT
  preferredCoin: process.env.PREFERRED_COIN ?? 'UCT',
  treasuryPollMs: int('TREASURY_POLL_MS', 5 * 60_000),
  autoSwap: bool('TREASURY_AUTO_SWAP', false), // SDK swaps need the experimental accounting module

  // market intent ---------------------------------------------------------------
  intentRefreshMs: int('INTENT_REFRESH_MS', 6 * HOUR),
  docsUrl: process.env.DOCS_URL ?? 'https://github.com/codewithshamim/notary',

  // pools -------------------------------------------------------------------------
  poolDeadlineMs: int('POOL_DEADLINE_MS', 24 * HOUR),

  // api ------------------------------------------------------------------------------
  // Railway (and most PaaS) inject the listen port as PORT; honour it, but let
  // an explicit API_PORT win for local/multi-service setups.
  apiPort: int('API_PORT', int('PORT', 8787)),
  apiHost: process.env.API_HOST ?? '0.0.0.0',

  // ops ---------------------------------------------------------------------
  resumeIntentsEveryMs: int('RESUME_INTENTS_EVERY_MS', 5 * 60_000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** How far back the DM subscription reaches on first connect (seconds). */
  dmLookbackSec: int('DM_LOOKBACK_SEC', 600),
};

export type Config = typeof config;
