import { useState } from 'react';
import { parseTokenAmount } from '@unicitylabs/sphere-sdk';
import { getSphere, humanError, uctCoinId } from '../lib/sphere.js';
import { human, shortAddr } from '../lib/format.js';
import { useWallet } from '../state/WalletContext.js';
import { NametagModal } from './NametagModal.js';

export function WalletWidget() {
  const { nametag, address, assets, refreshAssets } = useWallet();
  const [minting, setMinting] = useState(false);
  const [mintErr, setMintErr] = useState<string | null>(null);
  const [showTag, setShowTag] = useState(false);
  const [copied, setCopied] = useState(false);

  const uct = assets.find((a) => a.symbol === 'UCT');

  const mint = async () => {
    const sphere = getSphere();
    if (!sphere) return;
    setMinting(true);
    setMintErr(null);
    try {
      // No faucet on testnet2 — wallets self-mint test UCT via the token engine.
      // Mint 100 whole UCT (decimals-aware) so balances and deals are usable.
      const decimals = uct?.decimals ?? 18;
      const res = await sphere.payments.mintFungibleToken(uctCoinId(), parseTokenAmount('100', decimals));
      if (!res.success) throw new Error(res.error);
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
        title={address ?? ''}
        style={{ cursor: 'pointer' }}
        onClick={() => {
          if (address) {
            void navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
      >
        <span className="mono">{copied ? 'copied ✓' : shortAddr(address)}</span>
      </div>
      {nametag ? (
        <div className="wallet-chip">@{nametag}</div>
      ) : (
        <button className="btn small secondary" onClick={() => setShowTag(true)}>Pick a nametag</button>
      )}
      <div className="wallet-chip">
        <span className="bal">{uct ? human(uct.totalAmount, uct.decimals) : '0'}</span> UCT
      </div>
      <button className="btn small" onClick={() => void mint()} disabled={minting} title="Self-mint test UCT (no faucet on testnet2)">
        {minting ? <span className="spinner" /> : 'Get test tokens'}
      </button>
      {mintErr && <span className="error-text">{mintErr}</span>}
      {showTag && <NametagModal onClose={() => setShowTag(false)} />}
    </div>
  );
}
