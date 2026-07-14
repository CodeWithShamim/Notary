import { useSyncExternalStore } from 'react';
import {
  dismissSignature,
  getSignatureSnapshot,
  subscribeSignature,
  type SignatureKind,
} from '../lib/signaturePrompt.js';

/**
 * The "confirm in your wallet" overlay.
 *
 * Mounted once at the app root, it listens to the signature-prompt store and
 * renders a modern web3-style modal whenever a wallet intent is in flight -
 * pending → confirmed → declined. The actual signing still happens in the Sphere
 * wallet's own window; this just makes the request impossible to miss and gives
 * every action (fund / message / mint) a consistent, polished confirmation UX.
 */
export function SignaturePrompt() {
  const req = useSyncExternalStore(subscribeSignature, getSignatureSnapshot, () => null);
  if (!req) return null;

  const pending = req.status === 'pending';
  const error = req.status === 'error';
  const success = req.status === 'success';

  return (
    <div
      className="sig-backdrop"
      // Pending can't be dismissed by clicking away - the wallet is still waiting.
      onMouseDown={pending ? undefined : (e) => e.target === e.currentTarget && dismissSignature()}
      role="dialog"
      aria-modal="true"
      aria-label="Wallet signature request"
    >
      <div className={`sig-card ${req.status}`}>
        <div className="sig-glyph" aria-hidden="true">
          {pending && <span className="sig-ring" />}
          <span className="sig-icon">
            {success ? '✓' : error ? '✕' : <WalletGlyph kind={req.kind} />}
          </span>
        </div>

        <div className="sig-kind">{kindLabel(req.kind)}</div>
        <h3 className="sig-title">
          {success ? 'Confirmed' : error ? 'Request not completed' : req.title}
        </h3>

        {error ? (
          <p className="sig-summary">{req.error}</p>
        ) : (
          <>
            <p className="sig-summary">{req.summary}</p>
            {req.detail && <p className="sig-detail">{req.detail}</p>}
          </>
        )}

        {pending && (
          <div className="sig-status">
            <span className="sig-dots"><i /><i /><i /></span>
            Waiting for you to approve this in your Sphere wallet…
          </div>
        )}

        {pending && (
          <p className="sig-hint">
            Don't see it? Check for a wallet popup or your Sphere extension. Your keys never leave the wallet.
          </p>
        )}

        {(error || success) && (
          <button className="btn secondary sig-dismiss" onClick={dismissSignature}>
            {success ? 'Done' : 'Close'}
          </button>
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: SignatureKind): string {
  return kind === 'transfer' ? 'Transfer request' : kind === 'mint' ? 'Mint request' : 'Message request';
}

/** Minimal wallet mark shown while a request is pending. */
function WalletGlyph({ kind }: { kind: SignatureKind }) {
  if (kind === 'message') {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h13a2 2 0 012 2v3a2 2 0 01-2 2H3" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="16.5" cy="12.5" r="1.3" fill="currentColor" />
    </svg>
  );
}
