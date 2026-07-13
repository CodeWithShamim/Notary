/**
 * Client-side wallet singleton. Keys never leave the browser: the SDK's
 * localStorage provider persists the encrypted seed; the only server contact
 * is the Unicity gateway / wallet-api / relays themselves.
 */
import { Sphere, getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';

// Public testnet2 gateway key (published in the SDK README — not a secret;
// a MAINNET key would be and must never appear in client code).
const FALLBACK_TESTNET2_KEY = 'sk_ddc3cfcc001e4a28ac3fad7407f99590';

export const API_KEY: string = import.meta.env.VITE_UNICITY_API_KEY ?? FALLBACK_TESTNET2_KEY;
export const NOTARY_TAG: string = import.meta.env.VITE_NOTARY_TAG ?? 'notary';
export const AGENT_API: string = import.meta.env.VITE_AGENT_API ?? 'http://localhost:8787';

// Stable testnet2 UCT coin id (token registry). Used as a fallback because
// getCoinIdBySymbol('UCT') is undefined until the SDK finishes fetching the
// registry — which happens asynchronously around Sphere.init.
const FALLBACK_UCT_COIN_ID = 'f581d30f593e4b369d684a4563b5246f07b1d265f7178a2c0a82b81f39c24dc0';

/** Resolve UCT's hex coin id, tolerating a not-yet-loaded registry. */
export function uctCoinId(): string {
  return getCoinIdBySymbol('UCT') ?? FALLBACK_UCT_COIN_ID;
}

let instance: Sphere | null = null;

function buildProviders() {
  const base = createBrowserProviders({
    network: 'testnet', // = testnet2 v2 gateway
    oracle: { apiKey: API_KEY },
  });
  let deviceId = localStorage.getItem('notary.deviceId');
  if (!deviceId) {
    deviceId = `notary-web-${crypto.randomUUID()}`;
    localStorage.setItem('notary.deviceId', deviceId);
  }
  // Second layer: wallet-api rails (delivery mailbox + token storage) — without
  // this the wallet silently cannot send or receive v2 transfers.
  return createWalletApiProviders(base, {
    baseUrl: 'https://wallet-api.unicity.network',
    network: 'testnet2',
    deviceId,
  });
}

export async function walletExists(): Promise<boolean> {
  const { storage } = buildProviders();
  return Sphere.exists(storage);
}

export interface WalletBoot {
  sphere: Sphere;
  created: boolean;
  generatedMnemonic?: string;
}

export async function initWallet(mnemonic?: string): Promise<WalletBoot> {
  if (instance) return { sphere: instance, created: false };
  const providers = buildProviders();
  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    network: 'testnet',
    autoGenerate: true,
    mnemonic,
    dmSince: Math.floor(Date.now() / 1000) - 7 * 86_400, // catch deal.updates sent while away
  });
  instance = sphere;
  return { sphere, created, generatedMnemonic };
}

export function getSphere(): Sphere | null {
  return instance;
}

/** Danger zone: wipe the local wallet then restore from a mnemonic. */
export async function resetAndRestore(mnemonic: string): Promise<WalletBoot> {
  instance = null;
  // The SDK's browser storage lives under localStorage; clear its keys plus ours.
  const keep: Record<string, string> = {};
  const remembered = localStorage.getItem('notary.deals');
  if (remembered) keep['notary.deals.backup'] = remembered;
  localStorage.clear();
  for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
  return initWallet(mnemonic.trim());
}

/** Map raw SDK/gateway errors to something a human can act on. */
export function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code;
  if (code === 'INVALID_RECIPIENT' || msg.includes('INVALID_RECIPIENT')) {
    return 'That name has no published identity on the network. Ask them to register a nametag first.';
  }
  if (code === 'CERTIFICATION_UNCONFIRMED') {
    return 'The network could not confirm the payment yet — it may still complete. Do NOT retry; check your balance in a minute.';
  }
  if (msg.includes('AGGREGATOR_ERROR') || msg.includes('aggregator')) {
    return 'The Unicity gateway is unreachable or rejected the request. Check your connection and VITE_UNICITY_API_KEY.';
  }
  if (msg.toLowerCase().includes('already be taken') || msg.toLowerCase().includes('taken')) {
    return 'That nametag is already registered to a different wallet. Pick another one.';
  }
  if (msg.includes('insufficient') || msg.includes('Insufficient')) {
    return 'Not enough balance. Use "Get test tokens" to self-mint UCT on testnet.';
  }
  return msg;
}
