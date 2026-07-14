/**
 * Sphere Connect — dApp side.
 *
 * Lets a visitor connect their EXISTING Sphere wallet (extension / hosted app)
 * instead of creating a local one. Keys never leave the wallet: this app only
 * holds a session and asks the wallet to
 *   • satisfy read queries  (identity / balance / DMs), and
 *   • approve sensitive operations (send / dm / mint) as user-confirmed *intents*.
 *
 * Transport is auto-detected by the SDK's `autoConnect`:
 *   iframe → parent window · extension → content script · else → wallet popup.
 */
import {
  autoConnect,
  detectTransport,
  type AutoConnectResult,
} from '@unicitylabs/sphere-sdk/connect/browser';
import {
  PERMISSION_SCOPES,
  WALLET_EVENTS,
  type PermissionScope,
  type PublicIdentity,
} from '@unicitylabs/sphere-sdk/connect';

/** The `/connect` and `/connect/browser` entry points each declare their own
 *  `ConnectClient` class (private fields → nominal). Derive the type from what
 *  `autoConnect` actually returns so there is a single source of truth. */
export type ConnectClient = AutoConnectResult['client'];

/** Unicity testnet2 — canonical id is the RootTrustBase networkId (analogous to an EIP-155 chainId). */
export const TESTNET2 = { id: 4, name: 'testnet2' } as const;

/** Where the popup-fallback wallet lives (iframe / extension are auto-detected first). */
export const WALLET_URL: string =
  import.meta.env.VITE_SPHERE_WALLET_URL ?? 'https://sphere.unicity.network';

/**
 * Least-privilege scopes — exactly what Notary uses, never the full set:
 *   identity:read    who connected (nametag / address)
 *   balance:read     show the UCT balance
 *   dm:read          read deal.update / deal.invite DMs from @notary
 *   dm:request       send a deal proposal DM to @notary        (intent)
 *   transfer:request fund escrow / settle a deal               (intent)
 *   mint:request     self-mint test UCT on testnet2            (intent)
 *   resolve:peer     resolve @nametag → identity
 *   events:subscribe live transfer / identity / lock pushes
 * Deliberately omitted: tokens:read, history:read, dm:manage, payment:request,
 * sign:request, invoice:read, invoice:write.
 */
export const NOTARY_PERMISSIONS: PermissionScope[] = [
  PERMISSION_SCOPES.IDENTITY_READ,
  PERMISSION_SCOPES.BALANCE_READ,
  PERMISSION_SCOPES.DM_READ,
  PERMISSION_SCOPES.DM_REQUEST,
  PERMISSION_SCOPES.TRANSFER_REQUEST,
  PERMISSION_SCOPES.MINT_REQUEST,
  PERMISSION_SCOPES.RESOLVE_PEER,
  PERMISSION_SCOPES.EVENTS_SUBSCRIBE,
];

/** Wallet-pushed events the dApp reacts to. Re-exported so consumers need one import. */
export const CONNECT_EVENTS = WALLET_EVENTS;

const SESSION_KEY = 'notary.connect.sessionId';
const AUTOCONNECT_KEY = 'notary.connect.auto';

let active: AutoConnectResult | null = null;

/**
 * Auto-connect preference (persisted). When enabled, the app silently restores
 * an already-approved session on page load. Defaults to ON — a returning user
 * who connected before is reconnected without a click. An explicit disconnect
 * turns it off so the app doesn't immediately reconnect.
 */
export function isAutoConnectEnabled(): boolean {
  return localStorage.getItem(AUTOCONNECT_KEY) !== 'false';
}

export function setAutoConnectEnabled(enabled: boolean): void {
  localStorage.setItem(AUTOCONNECT_KEY, enabled ? 'true' : 'false');
}

function dappMetadata() {
  return {
    name: 'Notary — trustless escrow',
    description: 'Autonomous escrow & arbitration agent on the Unicity network.',
    url: window.location.origin,
    icon: `${window.location.origin}/favicon.svg`,
  };
}

export interface ConnectBoot {
  client: ConnectClient;
  identity: PublicIdentity;
  permissions: readonly PermissionScope[];
  transport: AutoConnectResult['transport'];
}

function boot(result: AutoConnectResult): ConnectBoot {
  return {
    client: result.client,
    identity: result.connection.identity,
    permissions: result.connection.permissions,
    transport: result.transport,
  };
}

/**
 * Connect to the user's Sphere wallet via `autoConnect`.
 *
 * @param silent when true, only restores a session the wallet has ALREADY
 *   approved for this origin and opens NO wallet UI — used for auto-connect on
 *   page load. Returns `null` (instead of throwing) when there is nothing to
 *   silently restore.
 */
export async function connect(opts: { silent?: boolean } = {}): Promise<ConnectBoot | null> {
  if (active) return boot(active);
  const resumeSessionId = localStorage.getItem(SESSION_KEY) ?? undefined;
  try {
    const result = await autoConnect({
      dapp: dappMetadata(),
      walletUrl: WALLET_URL,
      permissions: NOTARY_PERMISSIONS,
      network: TESTNET2,
      silent: opts.silent,
      resumeSessionId,
    });
    active = result;
    localStorage.setItem(SESSION_KEY, result.connection.sessionId);
    if (!opts.silent) setAutoConnectEnabled(true); // a real connect opts into auto-reconnect
    return boot(result);
  } catch (err) {
    localStorage.removeItem(SESSION_KEY); // stale/expired session id — don't keep retrying it
    if (opts.silent) return null; // no prior approval → stay disconnected, quietly
    throw err;
  }
}

export function getConnectClient(): ConnectClient | null {
  return active?.client ?? null;
}

/**
 * Whether a silent (no-UI) auto-connect can be attempted on page load.
 *
 * Only iframe and extension transports can restore an already-approved session
 * without UI. The popup transport ALWAYS opens a window — so we must never fire
 * a "silent" connect that would fall back to it, or the wallet pops up on every
 * load. In popup environments the user connects explicitly via the button.
 */
export function canAutoConnectSilently(): boolean {
  try {
    return detectTransport() !== 'popup';
  } catch {
    return false;
  }
}

/** Disconnect and clear the resumable session (also closes the popup in popup mode). */
export async function disconnect(): Promise<void> {
  localStorage.removeItem(SESSION_KEY);
  setAutoConnectEnabled(false); // explicit disconnect → don't auto-reconnect next load
  const current = active;
  active = null;
  if (current) {
    try {
      await current.disconnect();
    } catch {
      /* best effort */
    }
  }
}

// ---- typed operation helpers -------------------------------------------------
// Reads go through query(); sensitive ops through intent() (the wallet opens its
// own confirmation UI — this app never sees a key or signs anything itself).

export interface ConnectAsset {
  symbol: string;
  coinId: string;
  totalAmount: string;
  decimals: number;
}

export async function fetchIdentity(client: ConnectClient): Promise<PublicIdentity> {
  return client.query<PublicIdentity>('sphere_getIdentity');
}

export async function fetchAssets(client: ConnectClient): Promise<ConnectAsset[]> {
  const assets = await client.query<ConnectAsset[]>('sphere_getAssets');
  return Array.isArray(assets) ? assets : [];
}

/** Send a plaintext/JSON DM (e.g. a deal proposal to @notary). Wallet-confirmed. */
export async function sendDmIntent(
  client: ConnectClient,
  recipient: string,
  content: string,
): Promise<unknown> {
  return client.intent('dm', { recipient, content });
}

/** Transfer coins to a recipient (e.g. fund escrow). Wallet-confirmed.
 *  `memo` is attached so the notary can correlate the transfer to a deal — it
 *  scans incoming history for a memo naming the dealId (falling back to
 *  amount + timing). Wallets that ignore memos still fund correctly. */
export async function sendIntent(
  client: ConnectClient,
  params: { recipient: string; amount: string; coinId: string; memo?: string },
): Promise<unknown> {
  return client.intent('send', { ...params });
}

/** Self-mint test UCT on testnet2. Wallet-confirmed. */
export async function mintIntent(
  client: ConnectClient,
  params: { coinId: string; amount: string },
): Promise<unknown> {
  return client.intent('mint', { ...params });
}
