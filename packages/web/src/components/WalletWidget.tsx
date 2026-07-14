import { useState } from 'react';
import { human, shortAddr } from '../lib/format.js';
import { useConnect } from '../state/ConnectContext.js';
import { getConnectClient, mintIntent } from '../lib/connect.js';
import { humanError, uctCoinId } from '../lib/sphere.js';

/**
 * Header wallet control. When disconnected it's the single Connect button that
 * opens the wallet's approval UI; once connected it shows identity, live UCT
 * balance, a wallet-confirmed test-token mint, and disconnect.
 */
export function WalletWidget() {
  const { phase, error, nametag, address, assets, transport, connect, refreshAssets, disconnect } = useConnect();
  const [minting, setMinting] = useState(false);
  const [mintErr, setMintErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hovering, setHovering] = useState(false);

  const uct = assets.find((a) => a.symbol === 'UCT');

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

  return (
    <div className="wallet-widget">
      <div
        className="wallet-chip"
        title={`${address ?? ''}${transport ? ` · via ${transport}` : ''}`}
        style={{ cursor: 'pointer', position: 'relative' }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => {
          if (address) {
            void navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
      >
        <span className="mono">{copied ? 'copied ✓' : shortAddr(address)}</span>
        {nametag && hovering && <span className="wallet-nametag">@{nametag}</span>}
      </div>
      <div className="wallet-chip">
        <span className="bal">{uct ? human(uct.totalAmount, uct.decimals) : '0'}</span> UCT
      </div>
      <button className="btn small" onClick={() => void mint()} disabled={minting} title="Self-mint test UCT (no faucet on testnet2)">
        {minting ? <span className="spinner" /> : 'Get test tokens'}
      </button>
      <button className="btn small secondary" onClick={() => void disconnect()} title="Disconnect this Sphere wallet">
        Disconnect
      </button>
      {mintErr && <span className="error-text">{mintErr}</span>}
    </div>
  );
}
