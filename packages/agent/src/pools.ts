import { randomUUID } from 'node:crypto';
import { getCoinIdBySymbol, type PaymentRequestResponse, type Sphere } from '@unicitylabs/sphere-sdk';
import type { GroupMessageData } from '@unicitylabs/sphere-sdk';
import { computeFee } from '@notary/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import type { PoolRow, Store } from './db.js';

const HELP = `Group escrow pool commands:
  !pool create <amount-each> <coin> <purpose>   — start a pool (you are the creator)
  !pool join <id>                               — join; I DM you a payment request
  !pool status <id>                             — funding progress
  !pool payout <id> @recipient                  — creator only: pay the pot (minus ${config.feeBps / 100}% fee)
  !pool cancel <id>                             — creator only: refund every contributor
Partial pools auto-refund at the deadline.`;

export class PoolService {
  private unsubs: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sphere: Sphere,
    private readonly store: Store,
    /** Kicks the shared payout executor (owned by DealService). */
    private readonly flushPayouts: () => Promise<void>,
  ) {}

  async start(): Promise<void> {
    const gc = this.sphere.groupChat;
    if (!gc) {
      logger.warn('group chat module disabled — pools unavailable');
      return;
    }
    try {
      await gc.connect();
    } catch (err) {
      logger.warn({ err }, 'NIP-29 relay connect failed — pools disabled this run');
      return;
    }
    this.unsubs.push(gc.onMessage((m) => void this.onGroupMessage(m).catch((err) => logger.error({ err }, 'pool command failed'))));
    this.unsubs.push(this.sphere.payments.onPaymentRequestResponse((r) => void this.onPaymentResponse(r).catch((err) => logger.error({ err }, 'pool payment response failed'))));
    this.timer = setInterval(() => void this.tickDeadlines().catch((err) => logger.error({ err }, 'pool deadline tick failed')), config.timerPollMs);
    logger.info({ relays: gc.getRelayUrls() }, 'pool service listening on group chat');
  }

  stop(): void {
    for (const u of this.unsubs) u();
    if (this.timer) clearInterval(this.timer);
  }

  /** Join a NIP-29 group so pool commands there are heard (DM: "!pool watch <groupId>"). */
  async watchGroup(groupId: string): Promise<boolean> {
    const gc = this.sphere.groupChat;
    if (!gc) {
      logger.warn('watchGroup: no group chat module');
      return false;
    }
    try {
      const ok = await gc.joinGroup(groupId);
      logger.info({ groupId, ok }, 'watchGroup joinGroup returned');
      if (ok) {
        this.store.addLedger('pool_group_joined', { groupId });
        await this.say(groupId, `👋 @${config.nametag} is here. ${HELP}`);
      }
      return ok;
    } catch (err) {
      logger.error({ err, groupId }, 'watchGroup joinGroup threw');
      return false;
    }
  }

  private async onGroupMessage(m: GroupMessageData): Promise<void> {
    const text = m.content.trim();
    if (!text.toLowerCase().startsWith('!pool')) return;
    if (m.senderPubkey === this.sphere.groupChat?.getMyPublicKey()) return;
    if (m.id && !this.store.markProcessed(`gc:${m.id}`, m.senderPubkey)) return;

    const [, cmd, ...rest] = text.split(/\s+/);
    switch ((cmd ?? '').toLowerCase()) {
      case 'create':
        return this.cmdCreate(m, rest);
      case 'join':
        return this.cmdJoin(m, rest[0]);
      case 'status':
        return this.cmdStatus(m, rest[0]);
      case 'payout':
        return this.cmdPayout(m, rest[0], rest[1]);
      case 'cancel':
        return this.cmdCancel(m, rest[0]);
      default:
        return this.say(m.groupId, HELP, m.id);
    }
  }

  private async say(groupId: string, text: string, replyToId?: string): Promise<void> {
    try {
      await this.sphere.groupChat?.sendMessage(groupId, text, replyToId);
    } catch (err) {
      logger.warn({ err, groupId }, 'group send failed');
    }
  }

  private async cmdCreate(m: GroupMessageData, args: string[]): Promise<void> {
    const [amountRaw, coinRaw, ...purposeParts] = args;
    if (!amountRaw || !coinRaw || purposeParts.length === 0 || !/^\d+$/.test(amountRaw)) {
      return this.say(m.groupId, `Usage: !pool create <amount-each in base units> <coin> <purpose>\n${HELP}`, m.id);
    }
    const bySymbol = getCoinIdBySymbol(coinRaw);
    const coinId = bySymbol ?? coinRaw;
    const pool: PoolRow = {
      poolId: `pool_${randomUUID().slice(0, 6)}`,
      groupId: m.groupId,
      creatorPubkey: m.senderPubkey,
      creatorTag: m.senderNametag ?? null,
      amountEach: amountRaw,
      coinId,
      symbol: bySymbol ? coinRaw.toUpperCase() : null,
      purpose: purposeParts.join(' ').slice(0, 500),
      status: 'open',
      deadlineAt: Date.now() + config.poolDeadlineMs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.store.insertPool(pool);
    this.store.addLedger('pool_created', { poolId: pool.poolId, groupId: m.groupId, amountEach: pool.amountEach, coinId, purpose: pool.purpose });
    await this.say(
      m.groupId,
      `🏦 Pool ${pool.poolId} created by ${m.senderNametag ? '@' + m.senderNametag : m.senderPubkey.slice(0, 8)} — ${pool.amountEach} ${pool.symbol ?? coinId} each for "${pool.purpose}". Join with: !pool join ${pool.poolId} (deadline ${new Date(pool.deadlineAt).toISOString()})`,
      m.id,
    );
  }

  private async cmdJoin(m: GroupMessageData, poolId?: string): Promise<void> {
    const pool = poolId ? this.store.getPool(poolId) : undefined;
    if (!pool || pool.status !== 'open') return this.say(m.groupId, `No open pool ${poolId ?? ''}. !pool status <id> to check.`, m.id);
    if (!m.senderNametag) {
      return this.say(m.groupId, `You need a registered nametag to join (contributions and refunds ride payment requests). Register one and retry.`, m.id);
    }
    const existing = this.store.getPoolMembers(pool.poolId).find((x) => x.pubkey === m.senderPubkey);
    if (existing?.paid) return this.say(m.groupId, `@${m.senderNametag} you already contributed to ${pool.poolId}.`, m.id);

    const res = await this.sphere.payments.sendPaymentRequest(`@${m.senderNametag}`, {
      amount: pool.amountEach,
      coinId: pool.coinId,
      message: `Pool ${pool.poolId} contribution: "${pool.purpose}"`,
      metadata: { poolId: pool.poolId },
    });
    if (!res.success || !res.requestId) return this.say(m.groupId, `Could not send a payment request to @${m.senderNametag}: ${res.error ?? 'unknown error'}`, m.id);

    this.store.upsertPoolMember({
      poolId: pool.poolId,
      pubkey: m.senderPubkey,
      nametag: m.senderNametag,
      paid: 0,
      requestId: res.requestId,
      transferId: null,
      joinedAt: Date.now(),
    });
    await this.say(m.groupId, `@${m.senderNametag} joined ${pool.poolId} — check your wallet for a payment request of ${pool.amountEach} ${pool.symbol ?? pool.coinId}.`, m.id);
  }

  private async onPaymentResponse(r: PaymentRequestResponse): Promise<void> {
    if (r.responseType !== 'paid') return;
    const member = this.store.getPoolMemberByRequest(r.requestId);
    if (!member || member.paid) return;
    const pool = this.store.getPool(member.poolId);
    if (!pool || pool.status !== 'open') return;
    member.paid = 1;
    member.transferId = r.transferId ?? null;
    this.store.upsertPoolMember(member);
    this.store.addLedger('pool_contribution', { poolId: pool.poolId, member: member.nametag, transferId: r.transferId });
    const paid = this.store.getPoolMembers(pool.poolId).filter((x) => x.paid).length;
    await this.say(pool.groupId, `💰 ${pool.poolId}: @${member.nametag} paid in. Pot: ${(BigInt(pool.amountEach) * BigInt(paid)).toString()} ${pool.symbol ?? pool.coinId} from ${paid} contributor(s).`);
  }

  private async cmdStatus(m: GroupMessageData, poolId?: string): Promise<void> {
    const pool = poolId ? this.store.getPool(poolId) : undefined;
    if (!pool) return this.say(m.groupId, `Unknown pool ${poolId ?? ''}.`, m.id);
    const members = this.store.getPoolMembers(pool.poolId);
    const paid = members.filter((x) => x.paid);
    await this.say(
      m.groupId,
      `${pool.poolId} [${pool.status}] "${pool.purpose}" — ${pool.amountEach} ${pool.symbol ?? pool.coinId} each. Contributors: ${paid.map((x) => '@' + x.nametag).join(', ') || 'none yet'} (${paid.length} paid / ${members.length} joined). Pot: ${(BigInt(pool.amountEach) * BigInt(paid.length)).toString()}. Deadline ${new Date(pool.deadlineAt).toISOString()}.`,
      m.id,
    );
  }

  private async cmdPayout(m: GroupMessageData, poolId?: string, recipient?: string): Promise<void> {
    const pool = poolId ? this.store.getPool(poolId) : undefined;
    if (!pool || pool.status !== 'open') return this.say(m.groupId, `No open pool ${poolId ?? ''}.`, m.id);
    if (m.senderPubkey !== pool.creatorPubkey) return this.say(m.groupId, `Only the pool creator can pay out ${pool.poolId}.`, m.id);
    if (!recipient?.startsWith('@')) return this.say(m.groupId, `Usage: !pool payout ${pool.poolId} @recipient`, m.id);

    const paid = this.store.getPoolMembers(pool.poolId).filter((x) => x.paid);
    if (paid.length === 0) return this.say(m.groupId, `${pool.poolId} has no contributions to pay out.`, m.id);
    const pot = BigInt(pool.amountEach) * BigInt(paid.length);
    const fee = computeFee(pot, config.feeBps);
    const toRecipient = pot - fee;

    pool.status = 'paid_out';
    pool.updatedAt = Date.now();
    this.store.updatePool(pool);
    this.store.insertPayout({
      dealId: null,
      poolId: pool.poolId,
      kind: 'pool_payout',
      recipient,
      amount: toRecipient.toString(),
      coinId: pool.coinId,
      memo: `notary pool ${pool.poolId} payout: ${pool.purpose.slice(0, 80)}`,
      status: 'pending',
      transferId: null,
      attempts: 0,
      lastError: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.store.addLedger('pool_payout', { poolId: pool.poolId, recipient, amount: toRecipient.toString(), fee: fee.toString() });
    await this.flushPayouts();
    await this.say(m.groupId, `✅ ${pool.poolId} paying out ${toRecipient} ${pool.symbol ?? pool.coinId} to ${recipient} (${fee} retained as the ${config.feeBps / 100}% notary fee).`, m.id);
  }

  private async cmdCancel(m: GroupMessageData, poolId?: string): Promise<void> {
    const pool = poolId ? this.store.getPool(poolId) : undefined;
    if (!pool || pool.status !== 'open') return this.say(m.groupId, `No open pool ${poolId ?? ''}.`, m.id);
    if (m.senderPubkey !== pool.creatorPubkey) return this.say(m.groupId, `Only the pool creator can cancel ${pool.poolId}.`, m.id);
    await this.refundAll(pool, 'cancelled');
    await this.say(m.groupId, `↩️ ${pool.poolId} cancelled by the creator — all contributors refunded in full.`, m.id);
  }

  private async tickDeadlines(): Promise<void> {
    for (const pool of this.store.expiredOpenPools(Date.now())) {
      logger.info({ poolId: pool.poolId }, 'pool deadline reached — auto-refunding contributors');
      await this.refundAll(pool, 'expired');
      await this.say(pool.groupId, `⌛ ${pool.poolId} reached its deadline without payout — every contributor has been refunded in full.`);
    }
  }

  private async refundAll(pool: PoolRow, status: 'cancelled' | 'expired'): Promise<void> {
    pool.status = status;
    pool.updatedAt = Date.now();
    this.store.updatePool(pool);
    for (const member of this.store.getPoolMembers(pool.poolId).filter((x) => x.paid)) {
      this.store.insertPayout({
        dealId: null,
        poolId: pool.poolId,
        kind: 'pool_refund',
        recipient: `@${member.nametag}`,
        amount: pool.amountEach,
        coinId: pool.coinId,
        memo: `notary pool ${pool.poolId} refund (${status})`,
        status: 'pending',
        transferId: null,
        attempts: 0,
        lastError: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.store.addLedger('pool_refund_all', { poolId: pool.poolId, status });
    await this.flushPayouts();
  }
}
