/**
 * Demo toolkit: throwaway wallets on live testnet2. Each demo wallet gets its
 * own dataDir under .demo/ and a random nametag; wallets are reused across
 * runs of the same demo (dir persists) so nametag registration stays stable.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Sphere, getCoinIdBySymbol, type DirectMessage } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';
import { parseMessage, type NotaryMessage } from '@notary/shared';

export const API_KEY = process.env.UNICITY_API_KEY ?? 'sk_ddc3cfcc001e4a28ac3fad7407f99590'; // public testnet2 key
export const NOTARY_TAG = process.env.NOTARY_NAMETAG ?? 'notary';
export const AGENT_API = process.env.AGENT_API ?? 'http://localhost:8787';

const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m' };

export function say(who: string, text: string): void {
  const color = who === 'buyer' ? C.cyan : who === 'seller' ? C.magenta : who === 'demo' ? C.green : C.yellow;
  console.log(`${color}[${who}]${C.reset} ${text}`);
}

export interface Actor {
  name: string;
  sphere: Sphere;
  tag: string;
  /** Every protocol message received, newest last. */
  inbox: NotaryMessage[];
  /** Raw DMs (for help/error text). */
  rawInbox: DirectMessage[];
}

export async function makeActor(name: string, opts?: { groupChat?: boolean }): Promise<Actor> {
  const dir = `.demo/${name}`;
  mkdirSync(dir, { recursive: true });

  const base = createNodeProviders({
    network: 'testnet',
    dataDir: dir,
    tokensDir: `${dir}/tokens`,
    oracle: { apiKey: API_KEY },
  });
  const providers = createWalletApiProviders(base, {
    baseUrl: 'https://wallet-api.unicity.network',
    network: 'testnet2',
    deviceId: `notary-demo-${name}`,
  });
  const { sphere } = await Sphere.init({
    ...providers,
    network: 'testnet', // required at init too (TokenRegistry config)
    autoGenerate: true,
    groupChat: opts?.groupChat ?? false,
    dmSince: Math.floor(Date.now() / 1000) - 30,
  });

  // Stable per-directory nametag (registered once, reused on later runs).
  const tagFile = `${dir}/nametag.txt`;
  let tag = sphere.identity?.nametag ?? (existsSync(tagFile) ? readFileSync(tagFile, 'utf8').trim() : '');
  if (!tag) {
    tag = `${name.replace(/[^a-z0-9]/gi, '').slice(0, 8)}-${randomUUID().slice(0, 6)}`.toLowerCase();
    await sphere.registerNametag(tag);
    writeFileSync(tagFile, tag);
  } else if (!sphere.identity?.nametag) {
    await sphere.registerNametag(tag).catch(() => undefined); // re-register own tag is a no-op/recovers
  }

  const actor: Actor = { name, sphere, tag, inbox: [], rawInbox: [] };
  sphere.communications.onDirectMessage((msg) => {
    actor.rawInbox.push(msg);
    const parsed = parseMessage(msg.content);
    if (parsed.ok) {
      actor.inbox.push(parsed.msg);
      if (parsed.msg.type === 'deal.update') {
        say(name, `deal.update → ${parsed.msg.deal.dealId} is ${parsed.msg.deal.state}`);
      } else {
        say(name, `received ${parsed.msg.type}`);
      }
    } else {
      say(name, `${C.dim}DM: ${msg.content.slice(0, 140).replace(/\n/g, ' ')}${C.reset}`);
    }
  });

  say(name, `wallet ready — @${tag} (${sphere.identity?.directAddress?.slice(0, 24)}…)`);
  return actor;
}

export async function fund(actor: Actor, amount: bigint, symbol = 'UCT'): Promise<void> {
  const coinId = getCoinIdBySymbol(symbol);
  if (!coinId) throw new Error(`coin ${symbol} not in registry`);
  const assets = await actor.sphere.payments.getAssets(coinId);
  const balance = BigInt(assets[0]?.totalAmount ?? '0');
  if (balance >= amount) {
    say(actor.name, `balance ${balance} ${symbol} — no mint needed`);
    return;
  }
  say(actor.name, `self-minting ${amount - balance} ${symbol} (no faucet on testnet2)…`);
  const res = await actor.sphere.payments.mintFungibleToken(coinId, amount - balance);
  if (!res.success) throw new Error(`mint failed: ${res.error}`);
  say(actor.name, `minted ✓`);
}

export async function dmNotary(actor: Actor, msg: NotaryMessage): Promise<void> {
  await actor.sphere.communications.sendDM(`@${NOTARY_TAG}`, JSON.stringify(msg));
  say(actor.name, `→ @${NOTARY_TAG}: ${msg.type}`);
}

/** Wait until a matching protocol message shows up in the actor's inbox. */
export async function waitFor<T extends NotaryMessage>(
  actor: Actor,
  what: string,
  pred: (m: NotaryMessage) => m is T,
  timeoutMs = 120_000,
): Promise<T> {
  const start = Date.now();
  let seen = 0;
  while (Date.now() - start < timeoutMs) {
    for (; seen < actor.inbox.length; seen++) {
      const m = actor.inbox[seen]!;
      if (pred(m)) return m;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[${actor.name}] timed out waiting for ${what}`);
}

export function isUpdateTo(dealId: string | null, state: string) {
  return (m: NotaryMessage): m is Extract<NotaryMessage, { type: 'deal.update' }> =>
    m.type === 'deal.update' && (dealId === null || m.deal.dealId === dealId) && m.deal.state === state;
}

/** A run-unique marker so replayed DMs from earlier demo runs are ignored. */
export function runNonce(): string {
  return `#${randomUUID().slice(0, 8)}`;
}

/** Wait for the deal.invite whose deliverable carries our run nonce (not a stale one). */
export async function waitForInvite(seller: Actor, nonce: string, timeoutMs = 120_000): Promise<Extract<NotaryMessage, { type: 'deal.invite' }>> {
  return waitFor(
    seller,
    `deal.invite ${nonce}`,
    (m): m is Extract<NotaryMessage, { type: 'deal.invite' }> => m.type === 'deal.invite' && m.deliverable.includes(nonce),
    timeoutMs,
  );
}

export async function requireAgentOnline(): Promise<void> {
  try {
    const res = await fetch(`${AGENT_API}/api/status`);
    const body = (await res.json()) as { identity?: { nametag?: string } };
    say('demo', `agent online: @${body.identity?.nametag} at ${AGENT_API}`);
  } catch {
    console.error(`\n✗ The notary agent is not reachable at ${AGENT_API}.\n  Start it first:  npm run dev:agent\n`);
    process.exit(1);
  }
}

export async function balanceOf(actor: Actor, symbol = 'UCT'): Promise<bigint> {
  const coinId = getCoinIdBySymbol(symbol)!;
  const assets = await actor.sphere.payments.getAssets(coinId);
  return BigInt(assets[0]?.totalAmount ?? '0');
}

/**
 * Wait for the notary's escrow payment request for a given deal. Payment
 * requests are delivered via the wallet-api cursor, not only the live Nostr
 * handler — so we force a sync and poll the stored list (matching on the
 * deal-id metadata) rather than trusting onPaymentRequest to fire.
 */
export async function awaitPaymentRequest(actor: Actor, dealId: string, timeoutMs = 180_000): Promise<{ id: string; amount: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await actor.sphere.payments.syncPaymentRequests().catch(() => undefined);
    const pending = actor.sphere.payments.getPaymentRequests({ status: 'pending' });
    // NB: payment-request metadata is dropped on the wire (see NOTES §4); the
    // dealId is carried in the human message instead, so match on that.
    const hit = pending.find((r) => r.message?.includes(dealId));
    if (hit) return { id: hit.id, amount: hit.amount };
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`[${actor.name}] timed out waiting for payment request on ${dealId}`);
}
