import { randomUUID } from 'node:crypto';
import { Sphere, getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Store } from './db.js';

export interface BootResult {
  sphere: Sphere;
  created: boolean;
}

/**
 * Boot the agent's wallet. Two provider layers (base + wallet-api rails) —
 * skipping the second silently produces a wallet that cannot move v2 tokens.
 * Identity is persistent: FileStorageProvider(dataDir) + optional fixed
 * WALLET_MNEMONIC. Never a fresh random mnemonic per start.
 */
export async function bootSphere(store: Store, opts?: { groupChat?: boolean }): Promise<BootResult> {
  const base = createNodeProviders({
    network: config.network,
    dataDir: config.dataDir,
    tokensDir: `${config.dataDir}/tokens`,
    transport: config.extraRelays.length ? { additionalRelays: config.extraRelays } : undefined,
    oracle: { apiKey: config.apiKey },
  });

  // Stable device id -> wallet-api session survives restarts (no re-auth churn).
  let deviceId = store.getKV('deviceId');
  if (!deviceId) {
    deviceId = `notary-agent-${randomUUID()}`;
    store.setKV('deviceId', deviceId);
  }

  const providers = createWalletApiProviders(base, {
    baseUrl: config.walletApiUrl,
    network: 'testnet2',
    deviceId,
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: config.network, // required at init too (TokenRegistry config)
    autoGenerate: true,
    mnemonic: config.mnemonic,
    market: true,
    groupChat: opts?.groupChat ?? true,
    // Ephemeral DMs: process + forget. SDK dedup is off in this mode, so the
    // Store.idempotency table is the only replay guard — every handler checks it.
    communications: { cacheMessages: false },
    dmSince: Math.floor(Date.now() / 1000) - config.dmLookbackSec,
  });

  if (created) {
    logger.warn(
      { mnemonicGenerated: Boolean(generatedMnemonic) },
      'NEW wallet created — mnemonic persisted to dataDir. Back up wallet-data/ or set WALLET_MNEMONIC.',
    );
  }
  logger.info(
    { address: sphere.identity?.directAddress, pubkey: sphere.identity?.chainPubkey, nametag: sphere.identity?.nametag },
    'wallet ready',
  );

  // Money-safety: complete any spend interrupted mid-flight under its ORIGINAL
  // transferId (never re-send). The SDK runs this at init too; explicit call
  // makes the result visible in our logs.
  try {
    const resumed = await sphere.payments.resumeOpenIntents();
    if (resumed.resumed.length || resumed.conflicted.length || resumed.failed.length) {
      logger.info(resumed, 'resumed open payment intents');
    }
  } catch (err) {
    logger.warn({ err }, 'resumeOpenIntents failed (will retry on schedule)');
  }

  return { sphere, created };
}

/** Register (first boot) or verify (later boots) the agent's nametag. */
export async function ensureNametag(sphere: Sphere): Promise<string> {
  const want = config.nametag;
  const have = sphere.identity?.nametag;
  if (have) {
    if (have !== want) {
      logger.warn({ have, want }, 'wallet already owns a different nametag — keeping existing');
    }
    return have;
  }
  const available = await sphere.isNametagAvailable(want);
  if (!available) {
    // First-seen-wins and bound to a pubkey: if someone else owns it, this
    // wallet can never claim it. Loud, actionable failure.
    logger.error(
      { nametag: want },
      'NAMETAG TAKEN by another pubkey. If this was OUR previous wallet, restore wallet-data/ or WALLET_MNEMONIC. Otherwise set NOTARY_NAMETAG to a free name.',
    );
    throw new Error(`nametag @${want} is taken and this wallet does not own it`);
  }
  await sphere.registerNametag(want);
  logger.info({ nametag: want }, 'nametag registered');
  return want;
}

/** Self-mint UCT when the treasury drops below the floor (no faucet on testnet2). */
export async function ensureBalanceFloor(sphere: Sphere): Promise<void> {
  const coinId = getCoinIdBySymbol(config.preferredCoin);
  if (!coinId) {
    logger.error({ coin: config.preferredCoin }, 'preferred coin not in token registry');
    return;
  }
  const assets = await sphere.payments.getAssets(coinId);
  const balance = BigInt(assets[0]?.totalAmount ?? '0');
  if (balance >= config.treasuryFloor) return;
  logger.info(
    { balance: balance.toString(), floor: config.treasuryFloor.toString(), mint: config.treasuryMintAmount.toString() },
    'balance below floor — self-minting',
  );
  const res = await sphere.payments.mintFungibleToken(coinId, config.treasuryMintAmount);
  if (res.success) {
    logger.info({ tokenId: res.tokenId }, 'self-mint complete');
  } else {
    logger.error({ error: res.error }, 'self-mint FAILED (check UNICITY_API_KEY / gateway)');
  }
}
