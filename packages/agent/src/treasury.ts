import { getCoinIdBySymbol, type Sphere } from '@unicitylabs/sphere-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { ensureBalanceFloor } from './sphere.js';
import type { Store } from './db.js';

/**
 * Treasury loop:
 *  1. keep the preferred-coin balance above the floor (self-mint — no faucet);
 *  2. when fee income accumulates in a non-preferred coin past the threshold,
 *     rebalance by publishing a signed swap intent on the market (the SDK's
 *     P2P SwapModule requires the experimental accounting module the spec
 *     forbids, so DM-negotiated swaps stay behind TREASURY_AUTO_SWAP).
 * Every action is ledgered.
 */
export class Treasury {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sphere: Sphere,
    private readonly store: Store,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), config.treasuryPollMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await ensureBalanceFloor(this.sphere);
      await this.rebalance();
      this.store.setKV('treasuryLastRun', String(Date.now()));
    } catch (err) {
      logger.warn({ err }, 'treasury tick failed');
    } finally {
      this.running = false;
    }
  }

  private async rebalance(): Promise<void> {
    const preferredId = getCoinIdBySymbol(config.preferredCoin);
    const assets = await this.sphere.payments.getAssets();
    for (const asset of assets) {
      if (asset.coinId === preferredId) continue;
      const balance = BigInt(asset.totalAmount);
      if (balance <= config.treasuryThreshold) continue;

      // Don't spam: one open rebalance intent per coin at a time.
      const openKey = `rebalanceIntent:${asset.coinId}`;
      const existing = this.store.getKV(openKey);
      if (existing) {
        const { at } = JSON.parse(existing) as { at: number };
        if (Date.now() - at < config.intentRefreshMs) continue;
        await this.sphere.market?.closeIntent(JSON.parse(existing).intentId).catch(() => undefined);
      }

      logger.info({ coin: asset.symbol, balance: balance.toString() }, 'treasury over threshold in non-preferred coin — publishing swap intent');
      try {
        const result = await this.sphere.market?.postIntent({
          description:
            `Treasury rebalance: @${config.nametag} offers ${balance.toString()} base units of ${asset.symbol} (${asset.coinId.slice(0, 12)}…) ` +
            `in exchange for ${config.preferredCoin} at fair value. DM @${config.nametag} to negotiate a P2P swap.`,
          intentType: 'sell',
          category: 'swap',
          currency: config.preferredCoin,
          contactHandle: `@${config.nametag}`,
          expiresInDays: 3,
        });
        if (result) {
          this.store.setKV(openKey, JSON.stringify({ intentId: result.intentId, at: Date.now() }));
          this.store.addLedger('treasury_rebalance_intent', {
            coinId: asset.coinId,
            symbol: asset.symbol,
            balance: balance.toString(),
            threshold: config.treasuryThreshold.toString(),
            intentId: result.intentId,
          });
        }
      } catch (err) {
        logger.warn({ err, coin: asset.symbol }, 'rebalance intent publication failed');
      }
    }
  }

  async summary(): Promise<{ assets: { coinId: string; symbol: string; total: string; decimals: number }[]; lastRun: number | null }> {
    const assets = await this.sphere.payments.getAssets();
    const lastRun = this.store.getKV('treasuryLastRun');
    return {
      assets: assets.map((a) => ({ coinId: a.coinId, symbol: a.symbol, total: a.totalAmount, decimals: a.decimals })),
      lastRun: lastRun ? Number(lastRun) : null,
    };
  }
}
