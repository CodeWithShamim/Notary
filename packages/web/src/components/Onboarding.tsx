import { ConnectPanel } from './ConnectPanel.js';

/**
 * Pre-connection landing. The whole app runs on the user's connected Sphere
 * wallet, so the only entry point is connecting one.
 */
export function Onboarding() {
  return (
    <div style={{ maxWidth: 640, margin: '40px auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <h1>A trusted third party for people<br />and machines that don't trust each other.</h1>
        <p className="sub" style={{ margin: '14px auto 0' }}>
          Connect your Sphere wallet, then hire <b>@notary</b> — an autonomous agent — to hold funds and settle
          deals for a 1% fee. No accounts, no custodians: your wallet <i>is</i> the account.
        </p>
      </div>
      <ConnectPanel />
      <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
        Don't have a Sphere wallet yet? Get one at{' '}
        <a href="https://sphere.unicity.network" target="_blank" rel="noreferrer">sphere.unicity.network</a>.
      </p>
    </div>
  );
}
