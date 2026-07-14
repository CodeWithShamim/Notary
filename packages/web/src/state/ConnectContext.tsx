import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PublicIdentity } from '@unicitylabs/sphere-sdk/connect';
import { parseMessage, type DealSnapshot } from '@notary/shared';
import {
  CONNECT_EVENTS,
  connect as connectWallet,
  disconnect as disconnectWallet,
  fetchAssets,
  getConnectClient,
  isAutoConnectEnabled,
  sendIntent,
  setAutoConnectEnabled,
  type ConnectAsset,
} from '../lib/connect.js';
import { NOTARY_TAG } from '../lib/sphere.js';

export type ConnectPhase =
  | 'idle' // haven't connected yet
  | 'connecting' // handshake in flight
  | 'connected'
  | 'locked' // wallet locked / logged out — reconnect needed
  | 'error';

export interface StoredDeal {
  snapshot: DealSnapshot;
  receivedAt: number;
}

// Shapes returned by the Connect RPC queries (subset we use).
interface ConvoSummary {
  peerPubkey: string;
  peerNametag?: string;
  lastMessage: { timestamp: number };
}
interface ConvoMessage {
  content: string;
  timestamp: number;
  senderNametag?: string;
}
interface ConversationPage {
  messages: ConvoMessage[];
}

// Fields we read off a parsed deal.invite (structural — matches the shared schema).
interface DealInviteMsg {
  dealId: string;
  buyer: string;
  seller: string;
  amount: string;
  coinId: string;
  symbol?: string;
  deliverable: string;
  deliveryHours: number;
  feeBps: number;
  acceptBy: number;
}

interface ConnectState {
  phase: ConnectPhase;
  /** Silent auto-connect is in flight on load — restoring the session + user data. */
  restoring: boolean;
  error: string | null;
  identity: PublicIdentity | null;
  nametag: string | null;
  address: string | null;
  assets: ConnectAsset[];
  deals: Record<string, StoredDeal>;
  permissions: readonly string[];
  transport: string | null;
  /** Whether the app silently restores an approved session on load. */
  autoConnect: boolean;
  setAutoConnect: (enabled: boolean) => void;
  /** Interactive connect — opens the wallet's approval UI. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  refreshDeals: () => Promise<void>;
  /** Fund a deal's escrow: a wallet-confirmed transfer to @notary tagged with the dealId. */
  fundEscrow: (p: { dealId: string; amount: string; coinId: string }) => Promise<void>;
}

const Ctx = createContext<ConnectState | null>(null);

function syntheticFromInvite(inv: DealInviteMsg, ts: number): DealSnapshot {
  return {
    dealId: inv.dealId,
    state: 'PROPOSED',
    buyer: '',
    seller: '',
    buyerTag: inv.buyer,
    sellerTag: inv.seller,
    amount: inv.amount,
    coinId: inv.coinId,
    symbol: inv.symbol,
    feeBps: inv.feeBps,
    deliverable: inv.deliverable,
    deliveryHours: inv.deliveryHours,
    createdAt: ts,
    deadlineAt: inv.acceptBy,
  };
}

export function ConnectProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  // Start true when auto-connect is enabled so a returning visitor sees a loader
  // on refresh rather than a flash of the Connect button before the session restores.
  const [restoring, setRestoring] = useState<boolean>(isAutoConnectEnabled);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<PublicIdentity | null>(null);
  const [assets, setAssets] = useState<ConnectAsset[]>([]);
  const [deals, setDeals] = useState<Record<string, StoredDeal>>({});
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [transport, setTransport] = useState<string | null>(null);
  const [autoConnect, setAutoConnectState] = useState<boolean>(isAutoConnectEnabled);
  const unwire = useRef<(() => void) | null>(null);

  const setAutoConnect = useCallback((enabled: boolean) => {
    setAutoConnectEnabled(enabled);
    setAutoConnectState(enabled);
  }, []);

  const refreshAssets = useCallback(async () => {
    const client = getConnectClient();
    if (!client) return;
    try {
      setAssets(await fetchAssets(client));
    } catch {
      /* transient — keep the last known list */
    }
  }, []);

  // Reconstruct deal state from the @notary conversation. The wallet stores the
  // encrypted DM history; we read it (dm:read) and parse deal.update / deal.invite.
  const refreshDeals = useCallback(async () => {
    const client = getConnectClient();
    if (!client) return;
    try {
      const convos = await client.query<ConvoSummary[]>('sphere_getConversations');
      const notary = convos.find((c) => c.peerNametag?.toLowerCase() === NOTARY_TAG.toLowerCase());
      if (!notary) return;
      const page = await client.query<ConversationPage>('sphere_getMessages', {
        peerPubkey: notary.peerPubkey,
        limit: 200,
      });
      const updates: Record<string, StoredDeal> = {};
      const invites: Record<string, StoredDeal> = {};
      for (const m of page.messages) {
        const parsed = parseMessage(m.content);
        if (!parsed.ok) continue;
        if (parsed.msg.type === 'deal.update') {
          const snap = parsed.msg.deal;
          const prev = updates[snap.dealId];
          if (!prev || m.timestamp >= prev.receivedAt) updates[snap.dealId] = { snapshot: snap, receivedAt: m.timestamp };
        } else if (parsed.msg.type === 'deal.invite') {
          const snap = syntheticFromInvite(parsed.msg, m.timestamp);
          const prev = invites[snap.dealId];
          if (!prev || m.timestamp >= prev.receivedAt) invites[snap.dealId] = { snapshot: snap, receivedAt: m.timestamp };
        }
      }
      // A real deal.update always supersedes a synthetic invite for the same id.
      setDeals({ ...invites, ...updates });
    } catch {
      /* transient — keep the last known deals */
    }
  }, []);

  // Wire the wallet-pushed events the criteria require + live refresh. Idempotent.
  const wire = useCallback(
    (permsGranted: readonly string[]) => {
      const client = getConnectClient();
      if (!client) return;
      unwire.current?.();

      const offIdentity = client.on(CONNECT_EVENTS.IDENTITY_CHANGED, (data) => {
        setIdentity((data as PublicIdentity) ?? null);
        void refreshAssets();
        void refreshDeals();
      });
      const offLocked = client.on(CONNECT_EVENTS.LOCKED, () => {
        setPhase('locked');
        setAssets([]);
      });
      const offTransfer = permsGranted.includes('events:subscribe')
        ? client.on('transfer:incoming', () => {
            void refreshAssets();
            void refreshDeals();
          })
        : () => undefined;

      const assetPoll = setInterval(() => void refreshAssets(), 30_000);
      const dealPoll = setInterval(() => void refreshDeals(), 8_000);
      unwire.current = () => {
        offIdentity();
        offLocked();
        offTransfer();
        clearInterval(assetPoll);
        clearInterval(dealPoll);
      };
    },
    [refreshAssets, refreshDeals],
  );

  const applyBoot = useCallback(
    (result: NonNullable<Awaited<ReturnType<typeof connectWallet>>>) => {
      setIdentity(result.identity);
      setPermissions(result.permissions);
      setTransport(result.transport);
      setError(null);
      setPhase('connected');
      wire(result.permissions);
      void refreshAssets();
      void refreshDeals();
    },
    [wire, refreshAssets, refreshDeals],
  );

  // Silent auto-connect on load, when enabled. `silent` shows no wallet UI: a
  // returning visitor (already approved this origin) is reconnected without a
  // click, and a brand-new visitor resolves to null — leaving the Connect
  // button for the one-time approval. Runs for every transport, popup included.
  useEffect(() => {
    let cancelled = false;
    if (isAutoConnectEnabled()) {
      void (async () => {
        try {
          const result = await connectWallet({ silent: true });
          if (!cancelled && result) applyBoot(result);
        } catch {
          /* silent path never surfaces errors */
        } finally {
          if (!cancelled) setRestoring(false);
        }
      })();
    } else {
      setRestoring(false);
    }
    return () => {
      cancelled = true;
      unwire.current?.();
    };
  }, [applyBoot]);

  const connect = useCallback(async () => {
    setPhase('connecting');
    setError(null);
    try {
      const result = await connectWallet({ silent: false });
      if (result) {
        applyBoot(result);
        setAutoConnectState(true); // connectWallet enabled the pref — reflect it
      } else setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [applyBoot]);

  const disconnect = useCallback(async () => {
    unwire.current?.();
    unwire.current = null;
    await disconnectWallet(); // also disables the auto-connect pref
    setAutoConnectState(false);
    setIdentity(null);
    setAssets([]);
    setDeals({});
    setPermissions([]);
    setTransport(null);
    setPhase('idle');
  }, []);

  const fundEscrow = useCallback(
    async (p: { dealId: string; amount: string; coinId: string }) => {
      const client = getConnectClient();
      if (!client) throw new Error('Connect your Sphere wallet first.');
      await sendIntent(client, {
        recipient: `@${NOTARY_TAG}`,
        amount: p.amount,
        coinId: p.coinId,
        memo: `notary deal ${p.dealId}`,
      });
      await refreshAssets();
      await refreshDeals();
    },
    [refreshAssets, refreshDeals],
  );

  const nametag = identity?.nametag ?? null;
  const address = identity?.directAddress ?? identity?.chainPubkey ?? null;

  const value = useMemo<ConnectState>(
    () => ({
      phase,
      restoring,
      error,
      identity,
      nametag,
      address,
      assets,
      deals,
      permissions,
      transport,
      autoConnect,
      setAutoConnect,
      connect,
      disconnect,
      refreshAssets,
      refreshDeals,
      fundEscrow,
    }),
    [phase, restoring, error, identity, nametag, address, assets, deals, permissions, transport, autoConnect, setAutoConnect, connect, disconnect, refreshAssets, refreshDeals, fundEscrow],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnect(): ConnectState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConnect outside ConnectProvider');
  return ctx;
}
