import { useEffect, useRef, useState } from 'react';
import { human, shortAddr } from '../lib/format.js';
import { useConnect } from '../state/ConnectContext.js';
import { getConnectClient, mintIntent } from '../lib/connect.js';
import { humanError, uctCoinId } from '../lib/sphere.js';

/**
 * Header wallet control. When disconnected it's the single Connect button that
 * opens the wallet's approval UI; once connected it's a balance + address pill
 * that opens a dropdown with the live UCT balance, a wallet-confirmed test-token
 * mint, copy-address, and disconnect.
 */
export function WalletWidget() {
  const { phase, error, nametag, address, assets, transport, connect, refreshAssets, disconnect } = useConnect();
  const [minting, setMinting] = useState(false);
  const [mintErr, setMintErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const uct = assets.find((a) => a.symbol === 'UCT');
  const balance = uct ? human(uct.totalAmount, uct.decimals) : '0';

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Not connected yet — the navbar Connect button is the only entry point.
  if (phase !== 'connected') {
    const connecting = phase === 'connecting';
    return (
      <div className="wallet-widget">
        {phase === 'locked' && <span className="error-text">Wallet locked — reconnect</span>}
        {phase === 'error' && error && <span className="error-text">{error}</span>}
        <button className="btn small" onClick={() => void connect()} disabled={connecting} title="Connect your Sphere wallet">
          {connecting ? <span className="spinner" /> : 'Connect wallet'}
        </button>
      </div>
    );
  }

  const mint = async () => {
    const client = getConnectClient();
    if (!client) return;
    setMinting(true);
    setMintErr(null);
    try {
      // No faucet on testnet2 — the wallet self-mints test UCT (100 whole, 18 decimals).
      await mintIntent(client, { coinId: uctCoinId(), amount: (100n * 10n ** 18n).toString() });
      await refreshAssets();
    } catch (err) {
      setMintErr(humanError(err));
      setTimeout(() => setMintErr(null), 6000);
    } finally {
      setMinting(false);
    }
  };

  const copyAddress = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="wallet-widget" ref={rootRef}>
      <button
        className={`wallet-pill${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${address ?? ''}${transport ? ` · via ${transport}` : ''}`}
      >
        <span className="wallet-pill-bal">
          <span className="bal">{balance}</span> UCT
        </span>
        <span className="wallet-pill-id">
          <span className="wallet-avatar" aria-hidden="true" />
          <span className="mono">{nametag ? `@${nametag}` : shortAddr(address)}</span>
          <svg className="wallet-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="wallet-menu" role="menu">
          <div className="wallet-menu-bal">
            <div>
              <div className="wallet-menu-label">Balance</div>
              <div className="wallet-menu-amount">
                {balance} <span>UCT</span>
              </div>
            </div>
            <button className="wallet-menu-link" onClick={() => void mint()} disabled={minting} role="menuitem">
              {minting ? <span className="spinner" /> : 'Get test UCT'}
            </button>
          </div>

          <div className="wallet-menu-sep" />

          <button className="wallet-menu-item" onClick={copyAddress} role="menuitem">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            {copied ? 'Copied ✓' : 'Copy address'}
          </button>

          <button className="wallet-menu-item danger" onClick={() => void disconnect()} role="menuitem">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M9.5 11l3-3-3-3M12 8H6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Disconnect
          </button>

          {mintErr && <div className="wallet-menu-err">{mintErr}</div>}
        </div>
      )}
    </div>
  );
}
