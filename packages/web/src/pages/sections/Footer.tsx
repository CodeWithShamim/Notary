import { Link } from 'react-router-dom';
import { Reveal } from './Reveal.js';
import { ScaleIcon } from '../../components/Icon.js';

const NAV: { heading: string; links: { label: string; to: string; external?: boolean }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Open a deal', to: '/new' },
      { label: 'My deals', to: '/deals' },
      { label: 'Liquidity pools', to: '/pools' },
      { label: 'Agent status', to: '/agent' },
    ],
  },
  {
    heading: 'Protocol',
    links: [
      { label: 'How it works', to: '/#how' },
      { label: 'Unicity testnet', to: 'https://unicity.network', external: true },
      { label: 'Block explorer', to: 'https://explorer.unicity.network', external: true },
      { label: 'Docs', to: 'https://docs.unicity.network', external: true },
    ],
  },
  {
    heading: 'Community',
    links: [
      { label: 'GitHub', to: 'https://github.com', external: true },
      { label: 'X / Twitter', to: 'https://x.com', external: true },
      { label: 'Discord', to: 'https://discord.com', external: true },
      { label: 'Status', to: '/agent' },
    ],
  },
];

/**
 * Landing-page footer. Web3 aesthetic scoped to `.landing` (aurora glow,
 * gradient wordmark, glass badges) — the trust disclaimer that used to live in
 * App's plain footer is folded into the bottom bar here.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="lp-footer">
      <div className="lp-aurora lp-aurora-soft" aria-hidden="true" />
      <div className="lp-footer-inner">
        <Reveal from="up">
          <div className="lp-footer-top">
            <div className="lp-footer-brand">
              <Link to="/" className="lp-footer-word" aria-label="Notary home">
                <span className="lp-footer-seal" aria-hidden><ScaleIcon size={18} /></span>
                <span className="grad">Notary</span>
              </Link>
              <p className="lp-footer-tagline">
                Trustless escrow, settled by an autonomous agent. Your keys never leave this browser.
              </p>
              <span className="lp-badge online">
                <i /> Live on Unicity testnet2
              </span>
            </div>

            <nav className="lp-footer-nav" aria-label="Footer">
              {NAV.map((col) => (
                <div key={col.heading} className="lp-footer-col">
                  <h3 className="lp-footer-heading">{col.heading}</h3>
                  <ul>
                    {col.links.map((l) =>
                      l.external ? (
                        <li key={l.label}>
                          <a href={l.to} target="_blank" rel="noreferrer noopener">
                            {l.label}
                          </a>
                        </li>
                      ) : (
                        <li key={l.label}>
                          <Link to={l.to}>{l.label}</Link>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </Reveal>

        <div className="lp-footer-bottom">
          <p className="lp-footer-legal">© {year} Notary · Non-custodial · No cookies, no tracking</p>
          <p className="lp-footer-chain">
            Escrow decisions are made autonomously by the <span className="grad">@notary</span> agent over
            encrypted DMs.
          </p>
        </div>
      </div>
    </footer>
  );
}
