/**
 * Signature-request prompt store (framework-agnostic).
 *
 * Every wallet-confirmed operation goes through the Sphere wallet, which opens
 * its OWN confirmation UI (a popup window / extension panel / iframe). That UI
 * can be easy to miss, so this store lets the dApp render a modern "confirm in
 * your wallet" overlay for the whole in-flight window - the same pattern users
 * expect from RainbowKit / ConnectKit.
 *
 * It's a tiny external store (subscribe + snapshot) so `connect.ts` - which has
 * no React - can drive it, and a single `<SignaturePrompt />` at the app root
 * renders it via `useSyncExternalStore`. Wrap any intent with `requestSignature`
 * and the overlay handles pending → confirmed → declined automatically.
 */

export type SignatureKind = 'transfer' | 'message' | 'mint';
export type SignatureStatus = 'pending' | 'success' | 'error';

export interface SignatureDescriptor {
  kind: SignatureKind;
  /** Short heading, e.g. "Fund escrow" / "Accept deal". */
  title: string;
  /** One-line plain-language summary of what the wallet will sign. */
  summary: string;
  /** Optional secondary line (memo, deal id, recipient…). */
  detail?: string;
}

export interface SignatureRequest extends SignatureDescriptor {
  id: number;
  status: SignatureStatus;
  error?: string;
}

let current: SignatureRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(req: SignatureRequest | null) {
  current = req;
  emit();
}

export function subscribeSignature(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSignatureSnapshot(): SignatureRequest | null {
  return current;
}

/** Dismiss the overlay (used for the terminal success/error states). */
export function dismissSignature(): void {
  set(null);
}

/**
 * Show the "confirm in your wallet" overlay while `run` (a wallet intent) is in
 * flight, then reflect the outcome. Resolves/rejects with exactly what `run`
 * returns so callers are unaffected - this is a transparent UX wrapper.
 *
 * On success the overlay flashes a confirmation and auto-dismisses; on failure
 * (typically the user declining in the wallet) it shows the reason and waits for
 * a dismiss.
 */
export async function requestSignature<T>(
  descriptor: SignatureDescriptor,
  run: () => Promise<T>,
): Promise<T> {
  const id = nextId++;
  set({ ...descriptor, id, status: 'pending' });
  try {
    const result = await run();
    // Only advance if we're still the active request (a newer one may have replaced us).
    if (current?.id === id) {
      set({ ...descriptor, id, status: 'success' });
      setTimeout(() => {
        if (current?.id === id) set(null);
      }, 1200);
    }
    return result;
  } catch (err) {
    if (current?.id === id) {
      set({ ...descriptor, id, status: 'error', error: describeError(err) });
    }
    throw err;
  }
}

/** Wallet rejections vary by transport; normalise the common "user declined" shapes. */
function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/reject|denied|declined|cancel/i.test(msg)) return 'Request declined in your wallet.';
  return msg || 'The wallet could not complete this request.';
}
