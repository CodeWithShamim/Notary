import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { DealState } from '@notary/shared';

export interface DealRow {
  dealId: string;
  state: DealState;
  buyerPubkey: string; //   transport pubkey (authenticates buyer DMs)
  buyerTag: string; //      nametag (payout/refund address)
  sellerPubkey: string | null; // learned from the seller's first DM (accept/reject)
  sellerTag: string;
  amount: string; //        base units
  coinId: string;
  symbol: string | null;
  feeBps: number;
  deliverable: string;
  deliveryHours: number;
  proof: string | null;
  paymentRequestId: string | null;
  fundedTransferId: string | null;
  settlementJson: string | null;
  buyerEvidence: string | null; //  buyer's dispute reason + submitted evidence
  sellerEvidence: string | null; // seller's submitted evidence
  verdictJson: string | null; //    { buyerBps, rationale, arbiter } once RESOLVED
  buyerProposalBps: number | null; // sealed midpoint-settlement proposal (bps to buyer)
  sellerProposalBps: number | null; // "
  createdAt: number;
  deadlineAt: number | null;
  updatedAt: number;
}

export interface PayoutRow {
  id: number;
  dealId: string | null;
  poolId: string | null;
  kind: 'release' | 'refund' | 'dispute_refund' | 'arbitration' | 'pool_payout' | 'pool_refund';
  recipient: string; // @nametag
  amount: string;
  coinId: string;
  memo: string;
  status: 'pending' | 'sent' | 'unconfirmed' | 'failed';
  transferId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PoolRow {
  poolId: string;
  groupId: string;
  creatorPubkey: string;
  creatorTag: string | null;
  amountEach: string;
  coinId: string;
  symbol: string | null;
  purpose: string;
  status: 'open' | 'funded' | 'paid_out' | 'cancelled' | 'expired';
  deadlineAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReputationDealRow {
  state: DealState;
  buyerTag: string;
  sellerTag: string;
  amount: string;
  coinId: string;
  symbol: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PoolMemberRow {
  poolId: string;
  pubkey: string;
  nametag: string | null;
  paid: number; // 0 | 1
  requestId: string | null;
  transferId: string | null;
  joinedAt: number;
}

export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    // better-sqlite3 won't create parent dirs; on a fresh volume (Railway,
    // Docker) DB_PATH's directory may not exist yet, so ensure it.
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deals (
        dealId TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        buyerPubkey TEXT NOT NULL,
        buyerTag TEXT NOT NULL,
        sellerPubkey TEXT,
        sellerTag TEXT NOT NULL,
        amount TEXT NOT NULL,
        coinId TEXT NOT NULL,
        symbol TEXT,
        feeBps INTEGER NOT NULL,
        deliverable TEXT NOT NULL,
        deliveryHours INTEGER NOT NULL,
        proof TEXT,
        paymentRequestId TEXT,
        fundedTransferId TEXT,
        settlementJson TEXT,
        buyerEvidence TEXT,
        sellerEvidence TEXT,
        verdictJson TEXT,
        buyerProposalBps INTEGER,
        sellerProposalBps INTEGER,
        createdAt INTEGER NOT NULL,
        deadlineAt INTEGER,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deals_state ON deals(state);
      CREATE INDEX IF NOT EXISTS idx_deals_deadline ON deals(deadlineAt) WHERE deadlineAt IS NOT NULL;
      CREATE TABLE IF NOT EXISTS deal_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dealId TEXT NOT NULL,
        at INTEGER NOT NULL,
        event TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_deal ON deal_events(dealId, at);
      CREATE TABLE IF NOT EXISTS payouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dealId TEXT,
        poolId TEXT,
        kind TEXT NOT NULL,
        recipient TEXT NOT NULL,
        amount TEXT NOT NULL,
        coinId TEXT NOT NULL,
        memo TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        transferId TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
      CREATE TABLE IF NOT EXISTS pools (
        poolId TEXT PRIMARY KEY,
        groupId TEXT NOT NULL,
        creatorPubkey TEXT NOT NULL,
        creatorTag TEXT,
        amountEach TEXT NOT NULL,
        coinId TEXT NOT NULL,
        symbol TEXT,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        deadlineAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pool_members (
        poolId TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        nametag TEXT,
        paid INTEGER NOT NULL DEFAULT 0,
        requestId TEXT,
        transferId TEXT,
        joinedAt INTEGER NOT NULL,
        PRIMARY KEY (poolId, pubkey)
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        msgId TEXT NOT NULL,
        senderPubkey TEXT NOT NULL,
        processedAt INTEGER NOT NULL,
        PRIMARY KEY (msgId, senderPubkey)
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT NOT NULL
      );
    `);
    // Idempotent upgrades for DBs created before arbitration shipped.
    this.addColumn('deals', 'buyerEvidence', 'TEXT');
    this.addColumn('deals', 'sellerEvidence', 'TEXT');
    this.addColumn('deals', 'verdictJson', 'TEXT');
    this.addColumn('deals', 'buyerProposalBps', 'INTEGER');
    this.addColumn('deals', 'sellerProposalBps', 'INTEGER');
  }

  /** ALTER TABLE ADD COLUMN, but a no-op if the column already exists. */
  private addColumn(table: string, column: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  // -- kv --------------------------------------------------------------------
  getKV(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }
  setKV(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // -- idempotency -------------------------------------------------------------
  /** Returns true the FIRST time (msgId, sender) is seen; false on re-delivery. */
  markProcessed(msgId: string, senderPubkey: string): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO idempotency (msgId, senderPubkey, processedAt) VALUES (?, ?, ?)')
      .run(msgId, senderPubkey, Date.now());
    return res.changes === 1;
  }
  pruneIdempotency(olderThanMs: number): void {
    this.db.prepare('DELETE FROM idempotency WHERE processedAt < ?').run(Date.now() - olderThanMs);
  }

  // -- deals ---------------------------------------------------------------
  insertDeal(d: DealRow): void {
    this.db
      .prepare(
        `INSERT INTO deals (dealId, state, buyerPubkey, buyerTag, sellerPubkey, sellerTag, amount,
          coinId, symbol, feeBps, deliverable, deliveryHours, proof, paymentRequestId,
          fundedTransferId, settlementJson, buyerEvidence, sellerEvidence, verdictJson,
          buyerProposalBps, sellerProposalBps, createdAt, deadlineAt, updatedAt)
         VALUES (@dealId, @state, @buyerPubkey, @buyerTag, @sellerPubkey, @sellerTag, @amount,
          @coinId, @symbol, @feeBps, @deliverable, @deliveryHours, @proof, @paymentRequestId,
          @fundedTransferId, @settlementJson, @buyerEvidence, @sellerEvidence, @verdictJson,
          @buyerProposalBps, @sellerProposalBps, @createdAt, @deadlineAt, @updatedAt)`,
      )
      .run(d);
  }
  updateDeal(d: DealRow): void {
    this.db
      .prepare(
        `UPDATE deals SET state=@state, sellerPubkey=@sellerPubkey, proof=@proof,
          paymentRequestId=@paymentRequestId, fundedTransferId=@fundedTransferId,
          settlementJson=@settlementJson, buyerEvidence=@buyerEvidence,
          sellerEvidence=@sellerEvidence, verdictJson=@verdictJson,
          buyerProposalBps=@buyerProposalBps, sellerProposalBps=@sellerProposalBps,
          deadlineAt=@deadlineAt, updatedAt=@updatedAt
         WHERE dealId=@dealId`,
      )
      .run(d);
  }
  getDeal(dealId: string): DealRow | undefined {
    return this.db.prepare('SELECT * FROM deals WHERE dealId = ?').get(dealId) as DealRow | undefined;
  }
  getDealByPaymentRequest(requestId: string): DealRow | undefined {
    return this.db.prepare('SELECT * FROM deals WHERE paymentRequestId = ?').get(requestId) as
      | DealRow
      | undefined;
  }
  dealsWithExpiredTimers(now: number): DealRow[] {
    return this.db
      .prepare('SELECT * FROM deals WHERE deadlineAt IS NOT NULL AND deadlineAt <= ?')
      .all(now) as DealRow[];
  }
  countDealsByState(): Record<string, number> {
    const rows = this.db.prepare('SELECT state, COUNT(*) AS n FROM deals GROUP BY state').all() as {
      state: string;
      n: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.state, r.n]));
  }
  totalVolume(): { coinId: string; symbol: string | null; total: string }[] {
    // SQLite sums as float — recompute exactly in JS to keep the no-floats rule.
    const rows = this.db
      .prepare("SELECT coinId, symbol, amount FROM deals WHERE state IN ('FUNDED','DELIVERED_CLAIMED','DISPUTED','RELEASED','REFUNDED','RESOLVED')")
      .all() as { coinId: string; symbol: string | null; amount: string }[];
    const sums = new Map<string, { symbol: string | null; total: bigint }>();
    for (const r of rows) {
      const cur = sums.get(r.coinId) ?? { symbol: r.symbol, total: 0n };
      cur.total += BigInt(r.amount);
      sums.set(r.coinId, cur);
    }
    return [...sums.entries()].map(([coinId, v]) => ({ coinId, symbol: v.symbol, total: v.total.toString() }));
  }

  /** Reputation-relevant fields for every deal (party tags never leave the agent raw — the
   *  reputation endpoint aggregates these into per-nametag scores). */
  reputationRows(): ReputationDealRow[] {
    return this.db
      .prepare('SELECT state, buyerTag, sellerTag, amount, coinId, symbol, createdAt, updatedAt FROM deals')
      .all() as ReputationDealRow[];
  }

  // -- deal events (append-only ledger per deal) --------------------------------
  addDealEvent(dealId: string, event: string, detail?: string): void {
    this.db
      .prepare('INSERT INTO deal_events (dealId, at, event, detail) VALUES (?, ?, ?, ?)')
      .run(dealId, Date.now(), event, detail ?? null);
  }
  getDealEvents(dealId: string): { at: number; event: string; detail: string | null }[] {
    return this.db
      .prepare('SELECT at, event, detail FROM deal_events WHERE dealId = ? ORDER BY at, id')
      .all(dealId) as { at: number; event: string; detail: string | null }[];
  }

  // -- payouts -----------------------------------------------------------------
  insertPayout(p: Omit<PayoutRow, 'id'>): number {
    const res = this.db
      .prepare(
        `INSERT INTO payouts (dealId, poolId, kind, recipient, amount, coinId, memo, status,
          transferId, attempts, lastError, createdAt, updatedAt)
         VALUES (@dealId, @poolId, @kind, @recipient, @amount, @coinId, @memo, @status,
          @transferId, @attempts, @lastError, @createdAt, @updatedAt)`,
      )
      .run(p);
    return Number(res.lastInsertRowid);
  }
  updatePayout(p: PayoutRow): void {
    this.db
      .prepare(
        `UPDATE payouts SET status=@status, transferId=@transferId, attempts=@attempts,
          lastError=@lastError, updatedAt=@updatedAt WHERE id=@id`,
      )
      .run(p);
  }
  pendingPayouts(): PayoutRow[] {
    return this.db
      .prepare("SELECT * FROM payouts WHERE status IN ('pending','unconfirmed') ORDER BY id")
      .all() as PayoutRow[];
  }
  payoutsForDeal(dealId: string): PayoutRow[] {
    return this.db.prepare('SELECT * FROM payouts WHERE dealId = ? ORDER BY id').all(dealId) as PayoutRow[];
  }

  // -- pools ---------------------------------------------------------------------
  insertPool(p: PoolRow): void {
    this.db
      .prepare(
        `INSERT INTO pools (poolId, groupId, creatorPubkey, creatorTag, amountEach, coinId, symbol,
          purpose, status, deadlineAt, createdAt, updatedAt)
         VALUES (@poolId, @groupId, @creatorPubkey, @creatorTag, @amountEach, @coinId, @symbol,
          @purpose, @status, @deadlineAt, @createdAt, @updatedAt)`,
      )
      .run(p);
  }
  updatePool(p: PoolRow): void {
    this.db
      .prepare('UPDATE pools SET status=@status, deadlineAt=@deadlineAt, updatedAt=@updatedAt WHERE poolId=@poolId')
      .run(p);
  }
  getPool(poolId: string): PoolRow | undefined {
    return this.db.prepare('SELECT * FROM pools WHERE poolId = ?').get(poolId) as PoolRow | undefined;
  }
  listPools(): PoolRow[] {
    return this.db.prepare('SELECT * FROM pools ORDER BY createdAt DESC').all() as PoolRow[];
  }
  expiredOpenPools(now: number): PoolRow[] {
    return this.db.prepare("SELECT * FROM pools WHERE status = 'open' AND deadlineAt <= ?").all(now) as PoolRow[];
  }
  upsertPoolMember(m: PoolMemberRow): void {
    this.db
      .prepare(
        `INSERT INTO pool_members (poolId, pubkey, nametag, paid, requestId, transferId, joinedAt)
         VALUES (@poolId, @pubkey, @nametag, @paid, @requestId, @transferId, @joinedAt)
         ON CONFLICT(poolId, pubkey) DO UPDATE SET
           nametag=excluded.nametag, paid=excluded.paid,
           requestId=excluded.requestId, transferId=excluded.transferId`,
      )
      .run(m);
  }
  getPoolMembers(poolId: string): PoolMemberRow[] {
    return this.db.prepare('SELECT * FROM pool_members WHERE poolId = ? ORDER BY joinedAt').all(poolId) as PoolMemberRow[];
  }
  getPoolMemberByRequest(requestId: string): PoolMemberRow | undefined {
    return this.db.prepare('SELECT * FROM pool_members WHERE requestId = ?').get(requestId) as
      | PoolMemberRow
      | undefined;
  }

  // -- global ledger ----------------------------------------------------------------
  addLedger(kind: string, detail: object): void {
    this.db.prepare('INSERT INTO ledger (at, kind, detail) VALUES (?, ?, ?)').run(Date.now(), kind, JSON.stringify(detail));
  }
  recentLedger(limit = 50): { at: number; kind: string; detail: string }[] {
    return this.db.prepare('SELECT at, kind, detail FROM ledger ORDER BY id DESC LIMIT ?').all(limit) as {
      at: number;
      kind: string;
      detail: string;
    }[];
  }

  close(): void {
    this.db.close();
  }
}
