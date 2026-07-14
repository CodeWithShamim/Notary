import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { WalletWidget } from './WalletWidget.js';
import { AgentStatusBadge } from './AgentStatusBadge.js';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/new', label: 'New deal', end: false },
  { to: '/deals', label: 'My deals', end: false },
  { to: '/pools', label: 'Pools', end: false },
  { to: '/agent', label: 'Agent', end: false },
];

/**
 * Top navigation bar. Single-row on desktop (wordmark · links · wallet),
 * collapsing to a hamburger-driven drawer on narrow screens.
 */
export function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="seal">⚖</span> Notary
      </div>

      <nav className="mainnav" aria-label="Primary">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>

      <div className="topbar-agent">
        <AgentStatusBadge />
      </div>

      <div className="topbar-wallet">
        <WalletWidget />
      </div>

      <button
        className={`nav-toggle${open ? ' open' : ''}`}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && <div className="nav-scrim" onClick={() => setOpen(false)} />}

      <div className={`nav-drawer${open ? ' open' : ''}`}>
        <nav className="drawer-nav" aria-label="Mobile">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="drawer-agent">
          <AgentStatusBadge />
        </div>
        <div className="drawer-wallet">
          <WalletWidget />
        </div>
      </div>
    </header>
  );
}
