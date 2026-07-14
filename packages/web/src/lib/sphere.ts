/**
 * Shared constants and pure helpers.
 *
 * The app no longer runs a wallet in the browser — all wallet state and
 * operations go through the user's connected Sphere wallet (see lib/connect.ts).
 * This module keeps only the registry lookup + config that the rest of the UI
 * needs without a wallet instance.
 */
import { getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';

export const NOTARY_TAG: string = import.meta.env.VITE_NOTARY_TAG ?? 'notary';
export const AGENT_API: string = import.meta.env.VITE_AGENT_API ?? 'http://localhost:8787';

// Stable testnet2 UCT coin id (token registry). Fallback for when
// getCoinIdBySymbol('UCT') is undefined until the registry finishes loading.
const FALLBACK_UCT_COIN_ID = 'f581d30f593e4b369d684a4563b5246f07b1d265f7178a2c0a82b81f39c24dc0';

/** Resolve UCT's hex coin id, tolerating a not-yet-loaded registry. */
export function uctCoinId(): string {
  return getCoinIdBySymbol('UCT') ?? FALLBACK_UCT_COIN_ID;
}

/** Map raw SDK / wallet / gateway errors to something a human can act on. */
export function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number | string } | null)?.code;
  // Sphere Connect rejections carry numeric codes (see ERROR_CODES in the SDK).
  if (code === 4003 || /USER_REJECTED|rejected/i.test(msg)) {
    return 'You rejected the request in your wallet.';
  }
  if (code === 4001 || /NOT_CONNECTED/i.test(msg)) {
    return 'Wallet not connected. Connect your Sphere wallet and try again.';
  }
  if (code === 4004 || /SESSION_EXPIRED/i.test(msg)) {
    return 'Your wallet session expired. Reconnect and try again.';
  }
  if (code === 4002 || /PERMISSION_DENIED/i.test(msg)) {
    return 'Your wallet did not grant the permission this action needs.';
  }
  if (code === 4100 || /insufficient/i.test(msg)) {
    return 'Not enough balance. Use "Get test tokens" to self-mint UCT on testnet2.';
  }
  if (msg.includes('INVALID_RECIPIENT')) {
    return 'That name has no published identity on the network. Ask them to register a nametag first.';
  }
  if (/AGGREGATOR_ERROR|aggregator/.test(msg)) {
    return 'The Unicity gateway is unreachable or rejected the request. Check your connection.';
  }
  return msg;
}
