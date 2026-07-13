import type { Sphere } from '@unicitylabs/sphere-sdk';
import { PROTOCOL_VERSION } from '@notary/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Store } from './db.js';

/**
 * Advertise the escrow service on the signed-intent market so other agents
 * can discover @notary via semantic search. Re-published on an interval
 * (intents expire server-side).
 */
export class IntentPublisher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sphere: Sphere,
    private readonly store: Store,
  ) {}

  async start(): Promise<void> {
    await this.publish();
    this.timer = setInterval(() => void this.publish().catch((err) => logger.warn({ err }, 'intent refresh failed')), config.intentRefreshMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async publish(): Promise<void> {
    const market = this.sphere.market;
    if (!market) {
      logger.warn('market module disabled — no intent published');
      return;
    }
    try {
      // Close the previous ad so search doesn't return stale duplicates.
      const prev = this.store.getKV('intentId');
      if (prev) await market.closeIntent(prev).catch(() => undefined);

      const result = await market.postIntent({
        description:
          `Escrow and arbitration service for the machine economy. @${config.nametag} holds funds between ` +
          `an untrusting buyer and seller and settles autonomously for a ${config.feeBps / 100}% fee: ` +
          `payment-request funding, timed delivery windows, silence-is-acceptance release, automatic timeout refunds, ` +
          `deterministic dispute handling, and NIP-29 group escrow pools. ` +
          `Speak JSON over NIP-17 DM to @${config.nametag} (protocol v${PROTOCOL_VERSION}). ` +
          `Start with {"v":1,"type":"deal.open",...} or send "help". Docs: ${config.docsUrl}`,
        intentType: 'service',
        category: 'escrow',
        currency: config.preferredCoin,
        contactHandle: `@${config.nametag}`,
        expiresInDays: 7,
      });
      this.store.setKV('intentId', result.intentId);
      this.store.addLedger('intent_published', { intentId: result.intentId, expiresAt: result.expiresAt });
      logger.info({ intentId: result.intentId }, 'service intent published to market');
    } catch (err) {
      logger.warn({ err }, 'intent publication failed (market may be unreachable) — will retry on schedule');
    }
  }
}
