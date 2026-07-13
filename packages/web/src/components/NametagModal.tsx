import { useState } from 'react';
import { getSphere, humanError } from '../lib/sphere.js';
import { useWallet } from '../state/WalletContext.js';

export function NametagModal({ onClose }: { onClose: () => void }) {
  const { refreshIdentity } = useWallet();
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<'unknown' | 'free' | 'taken'>('unknown');
  const [err, setErr] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const normalized = name.trim().toLowerCase().replace(/^@/, '');
  const valid = /^[a-z0-9_-]{3,20}$/.test(normalized);

  const check = async () => {
    const sphere = getSphere();
    if (!sphere || !valid) return;
    setChecking(true);
    setErr(null);
    try {
      setAvailability((await sphere.isNametagAvailable(normalized)) ? 'free' : 'taken');
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setChecking(false);
    }
  };

  const register = async () => {
    const sphere = getSphere();
    if (!sphere) return;
    setRegistering(true);
    setErr(null);
    try {
      await sphere.registerNametag(normalized);
      refreshIdentity();
      onClose();
    } catch (e) {
      // First-seen-wins: taken names are bound to another pubkey forever.
      setErr(humanError(e));
      setAvailability('taken');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Register your nametag</h2>
        <p className="muted">
          Your nametag (like <code>@alice</code>) is how deals pay you — sellers receive releases and buyers
          receive refunds at their nametag. Registration is first-come-first-served and permanent for this wallet.
        </p>
        <label className="field">
          <span>Nametag (3–20 chars: a–z, 0–9, _ or -)</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setAvailability('unknown');
            }}
            placeholder="alice"
            autoFocus
          />
        </label>
        {availability === 'free' && <p className="ok-text">@{normalized} is available ✓</p>}
        {availability === 'taken' && <p className="error-text">@{normalized} is already registered to a different wallet — pick another.</p>}
        {err && <p className="error-text">{err}</p>}
        <div className="row" style={{ marginTop: 10 }}>
          {availability !== 'free' ? (
            <button className="btn" onClick={() => void check()} disabled={!valid || checking}>
              {checking ? <span className="spinner" /> : 'Check availability'}
            </button>
          ) : (
            <button className="btn" onClick={() => void register()} disabled={registering}>
              {registering ? <span className="spinner" /> : `Register @${normalized}`}
            </button>
          )}
          <button className="btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
