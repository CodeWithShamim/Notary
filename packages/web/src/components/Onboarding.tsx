import { useState } from 'react';
import { humanError, resetAndRestore } from '../lib/sphere.js';
import { useWallet } from '../state/WalletContext.js';

export function Onboarding() {
  const { phase, error, createWallet, generatedMnemonic, confirmBackup, bootExisting } = useWallet();
  const [mode, setMode] = useState<'choose' | 'restore'>('choose');
  const [restoreWords, setRestoreWords] = useState('');
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [savedChecked, setSavedChecked] = useState(false);

  if (phase === 'checking' || phase === 'booting') {
    return (
      <div className="empty">
        <div className="big"><span className="spinner" /></div>
        {phase === 'checking' ? 'Looking for a wallet in this browser…' : 'Connecting to Unicity testnet2…'}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
        <h2>Could not start the wallet</h2>
        <p className="error-text">{error}</p>
        <button className="btn" onClick={() => void bootExisting()}>Retry</button>
      </div>
    );
  }

  // Forced backup step — the mnemonic is shown exactly once.
  if (phase === 'backup' && generatedMnemonic) {
    const words = generatedMnemonic.split(' ');
    return (
      <div className="card" style={{ maxWidth: 640, margin: '40px auto' }}>
        <h2>Back up your recovery phrase</h2>
        <p className="sub">
          These 12 words are the <b>only</b> way to recover your wallet and any escrowed funds if this
          browser's storage is cleared. Write them down in order. Nobody — not even the notary — can restore
          them for you.
        </p>
        <div className={`mnemonic ${revealed ? '' : 'blurred'}`} onClick={() => setRevealed(true)} title={revealed ? '' : 'Click to reveal'}>
          {words.map((w, i) => (
            <span key={i}><i>{i + 1}.</i>{w}</span>
          ))}
        </div>
        {!revealed && <button className="btn secondary" onClick={() => setRevealed(true)}>Reveal phrase</button>}
        {revealed && (
          <>
            <label className="row" style={{ margin: '14px 0', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={savedChecked} onChange={(e) => setSavedChecked(e.target.checked)} />
              <span>I wrote down all 12 words and understand they cannot be recovered.</span>
            </label>
            <button className="btn" disabled={!savedChecked} onClick={confirmBackup}>Continue to Notary</button>
          </>
        )}
      </div>
    );
  }

  if (mode === 'restore') {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
        <h2>Restore a wallet</h2>
        <p className="sub">Enter your 12-word recovery phrase. This replaces any wallet currently in this browser.</p>
        <label className="field">
          <span>Recovery phrase</span>
          <textarea value={restoreWords} onChange={(e) => setRestoreWords(e.target.value)} placeholder="apple banana carrot …" rows={3} />
        </label>
        {restoreErr && <p className="error-text">{restoreErr}</p>}
        <div className="row">
          <button
            className="btn"
            disabled={restoring || restoreWords.trim().split(/\s+/).length < 12}
            onClick={() => {
              setRestoring(true);
              setRestoreErr(null);
              resetAndRestore(restoreWords)
                .then(() => window.location.reload())
                .catch((err) => {
                  setRestoreErr(humanError(err));
                  setRestoring(false);
                });
            }}
          >
            {restoring ? <span className="spinner" /> : 'Restore wallet'}
          </button>
          <button className="btn secondary" onClick={() => setMode('choose')}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 34 }}>
        <h1>A trusted third party for people<br />and machines that don't trust each other.</h1>
        <p className="sub" style={{ margin: '14px auto 0' }}>
          Get a real Unicity wallet in your browser, then hire <b>@notary</b> — an autonomous agent — to hold
          funds and settle deals for a 1% fee. No accounts, no custodians: the wallet <i>is</i> the account.
        </p>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>New here</h2>
          <p className="muted">Creates a fresh wallet inside this browser (client-side keys) on testnet2.</p>
          <button className="btn" onClick={() => void createWallet()}>Create my wallet</button>
        </div>
        <div className="card">
          <h2>Returning</h2>
          <p className="muted">Restore an existing wallet from its 12-word recovery phrase.</p>
          <button className="btn secondary" onClick={() => setMode('restore')}>Restore from phrase</button>
        </div>
      </div>
    </div>
  );
}
