import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { WalletWidget } from './WalletWidget.js';
import { AgentStatusBadge } from './AgentStatusBadge.js';
import { ThemeToggle } from './ThemeToggle.js';
import { HomeIcon, PlusCircleIcon, FileTextIcon, LayersIcon, BotIcon, BookIcon, ScaleIcon } from './Icon.js';

const LINKS = [
  { to: '/', label: 'Home', end: true, Icon: HomeIcon },
  { to: '/new', label: 'New deal', end: false, Icon: PlusCircleIcon },
  { to: '/deals', label: 'My deals', end: false, Icon: FileTextIcon },
  { to: '/pools', label: 'Pools', end: false, Icon: LayersIcon },
  { to: '/reputation', label: 'Reputation', end: false, Icon: ScaleIcon },
  { to: '/agent', label: 'Agent', end: false, Icon: BotIcon },
  { to: '/docs', label: 'Docs', end: false, Icon: BookIcon },
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
      <Link to="/" className="wordmark" aria-label="Notary home">
        <span className="seal"><ScaleIcon size={20} /></span> Notary
      </Link>

      <nav className="mainnav" aria-label="Primary">
        {LINKS.map(({ to, label, end, Icon }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={17} className="nav-ico" /> {label}
          </NavLink>
        ))}
      </nav>

      <div className="topbar-agent">
        <AgentStatusBadge />
      </div>

      <div className="topbar-theme">
        <ThemeToggle />
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
          {LINKS.map(({ to, label, end, Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={18} className="nav-ico" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="drawer-agent">
          <AgentStatusBadge />
        </div>
        <div className="drawer-theme">
          <span className="drawer-theme-label">Theme</span>
          <ThemeToggle />
        </div>
        <div className="drawer-wallet">
          <WalletWidget />
        </div>
      </div>
    </header>
  );
}
