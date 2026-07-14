import { useConnect } from '../state/ConnectContext.js';
import { NOTARY_PERMISSIONS } from '../lib/connect.js';

/**
 * "Connect your Sphere wallet" card, shown until a session is established.
 * Runs `autoConnect` (iframe / extension / popup, auto-detected). Keys stay in
 * the wallet — Notary only requests least-privilege permissions.
 */
export function ConnectPanel() {
  const { phase, error, connect } = useConnect();
  const connecting = phase === 'connecting';

  return (
    <div className="card">
      <h2>Connect your Sphere wallet</h2>
      <p className="muted">
        Notary uses your existing Sphere wallet on <b>testnet2</b>. Your keys never leave the wallet — this app
        requests only {NOTARY_PERMISSIONS.length} least-privilege permissions and asks the wallet to approve
        every transfer as an intent.
      </p>
      <ul className="muted" style={{ margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.7 }}>
        <li>Read your identity &amp; UCT balance</li>
        <li>Read &amp; send deal DMs to @notary</li>
        <li>Approve escrow funding &amp; test-token mints (you confirm each one)</li>
      </ul>
      {phase === 'locked' && (
        <p className="error-text">Your wallet is locked. Unlock it, then reconnect.</p>
      )}
      {phase === 'error' && error && <p className="error-text">{error}</p>}
      <button className="btn" disabled={connecting} onClick={() => void connect()}>
        {connecting ? <span className="spinner" /> : 'Connect Sphere wallet'}
      </button>
    </div>
  );
}
