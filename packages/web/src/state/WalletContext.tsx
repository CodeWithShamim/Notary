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
import type { Asset, IncomingPaymentRequest, Sphere } from '@unicitylabs/sphere-sdk';
import { parseMessage, type DealSnapshot } from '@notary/shared';
import { getSphere, initWallet, walletExists, type WalletBoot } from '../lib/sphere.js';

export type WalletPhase = 'checking' | 'none' | 'booting' | 'backup' | 'ready' | 'error';

export interface StoredDeal {
  snapshot: DealSnapshot;
  receivedAt: number;
}

interface WalletState {
  phase: WalletPhase;
  error: string | null;
  sphere: Sphere | null;
  nametag: string | null;
  address: string | null;
  assets: Asset[];
  deals: Record<string, StoredDeal>;
  paymentRequests: IncomingPaymentRequest[];
  generatedMnemonic: string | null;
  createWallet: () => Promise<void>;
  confirmBackup: () => void;
  refreshAssets: () => Promise<void>;
  refreshIdentity: () => void;
  dismissRequest: (id: string) => void;
  bootExisting: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

const DEALS_KEY = 'notary.deals';

function loadDeals(): Record<string, StoredDeal> {
  try {
    return JSON.parse(localStorage.getItem(DEALS_KEY) ?? '{}') as Record<string, StoredDeal>;
  } catch {
    return {};
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<WalletPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [nametag, setNametag] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [deals, setDeals] = useState<Record<string, StoredDeal>>(loadDeals);
  const [paymentRequests, setPaymentRequests] = useState<IncomingPaymentRequest[]>([]);
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);
  const wired = useRef(false);

  const persistDeals = useCallback((next: Record<string, StoredDeal>) => {
    setDeals(next);
    localStorage.setItem(DEALS_KEY, JSON.stringify(next));
  }, []);

  const refreshAssets = useCallback(async () => {
    const sphere = getSphere();
    if (!sphere) return;
    try {
      setAssets(await sphere.payments.getAssets());
    } catch {
      /* transient — keep the last known list */
    }
  }, []);

  const refreshIdentity = useCallback(() => {
    const sphere = getSphere();
    setNametag(sphere?.identity?.nametag ?? null);
    setAddress(sphere?.identity?.directAddress ?? null);
  }, []);

  const wire = useCallback(
    (sphere: Sphere) => {
      if (wired.current) return;
      wired.current = true;
      refreshIdentity();
      void refreshAssets();

      // deal.update DMs are the live channel for deal state.
      sphere.communications.onDirectMessage((msg) => {
        const parsed = parseMessage(msg.content);
        if (parsed.ok && parsed.msg.type === 'deal.update') {
          const snap = parsed.msg.deal;
          setDeals((prev) => {
            const next = { ...prev, [snap.dealId]: { snapshot: snap, receivedAt: Date.now() } };
            localStorage.setItem(DEALS_KEY, JSON.stringify(next));
            return next;
          });
          void refreshAssets();
        }
        if (parsed.ok && parsed.msg.type === 'deal.invite') {
          // Surface invites as a synthetic PROPOSED snapshot so sellers see the
          // deal instantly (the notary's own deal.update follows anyway).
          const inv = parsed.msg;
          setDeals((prev) => {
            if (prev[inv.dealId]) return prev;
            const snapshot: DealSnapshot = {
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
              createdAt: Date.now(),
              deadlineAt: inv.acceptBy,
            };
            const next = { ...prev, [inv.dealId]: { snapshot, receivedAt: Date.now() } };
            localStorage.setItem(DEALS_KEY, JSON.stringify(next));
            return next;
          });
        }
      });

      const ingestRequests = () => {
        // Payment requests arrive over the wallet-api cursor, not just the live
        // Nostr handler — the pending list is authoritative. A paid/declined
        // request drops out of it, so this list stays exactly the open ones.
        const pending = sphere.payments.getPaymentRequests({ status: 'pending' });
        setPaymentRequests((prev) => {
          const same = prev.length === pending.length && prev.every((r, i) => r.id === pending[i]?.id);
          return same ? prev : pending;
        });
      };
      sphere.payments.onPaymentRequest(() => ingestRequests());

      sphere.on('nametag:registered', refreshIdentity);
      sphere.on('nametag:recovered', refreshIdentity);
      sphere.on('transfer:incoming', () => void refreshAssets());
      sphere.on('transfer:confirmed', () => void refreshAssets());
      const poll = setInterval(() => void refreshAssets(), 30_000);
      const prPoll = setInterval(() => {
        void sphere.payments.syncPaymentRequests().then(ingestRequests).catch(() => undefined);
      }, 6_000);
      void sphere.payments.syncPaymentRequests().then(ingestRequests).catch(() => undefined);
      return () => {
        clearInterval(poll);
        clearInterval(prPoll);
      };
    },
    [refreshAssets, refreshIdentity],
  );

  const bootExisting = useCallback(async () => {
    setPhase('booting');
    try {
      const boot: WalletBoot = await initWallet();
      wire(boot.sphere);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [wire]);

  useEffect(() => {
    void (async () => {
      try {
        if (await walletExists()) await bootExisting();
        else setPhase('none');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
  }, [bootExisting]);

  const createWallet = useCallback(async () => {
    setPhase('booting');
    try {
      const boot = await initWallet();
      if (boot.created && boot.generatedMnemonic) {
        setGeneratedMnemonic(boot.generatedMnemonic);
        wire(boot.sphere);
        setPhase('backup'); // forced backup step before anything else
      } else {
        wire(boot.sphere);
        setPhase('ready');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [wire]);

  const confirmBackup = useCallback(() => {
    setGeneratedMnemonic(null);
    setPhase('ready');
  }, []);

  const dismissRequest = useCallback((id: string) => {
    setPaymentRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      phase,
      error,
      sphere: getSphere(),
      nametag,
      address,
      assets,
      deals,
      paymentRequests,
      generatedMnemonic,
      createWallet,
      confirmBackup,
      refreshAssets,
      refreshIdentity,
      dismissRequest,
      bootExisting,
    }),
    [phase, error, nametag, address, assets, deals, paymentRequests, generatedMnemonic, createWallet, confirmBackup, refreshAssets, refreshIdentity, dismissRequest, bootExisting],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}
