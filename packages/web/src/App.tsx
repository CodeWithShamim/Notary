import { NavLink, Route, Routes } from 'react-router-dom';
import { useWallet } from './state/WalletContext.js';
import { Onboarding } from './components/Onboarding.js';
import { WalletWidget } from './components/WalletWidget.js';
import { Home } from './pages/Home.js';
import { NewDeal } from './pages/NewDeal.js';
import { MyDeals } from './pages/MyDeals.js';
import { DealDetail } from './pages/DealDetail.js';
import { AgentStatus } from './pages/AgentStatus.js';
import { Pools } from './pages/Pools.js';

export default function App() {
  const { phase } = useWallet();

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <span className="seal">⚖</span> Notary
        </div>
        {phase === 'ready' && (
          <>
            <nav className="mainnav">
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>Home</NavLink>
              <NavLink to="/new" className={({ isActive }) => (isActive ? 'active' : '')}>New deal</NavLink>
              <NavLink to="/deals" className={({ isActive }) => (isActive ? 'active' : '')}>My deals</NavLink>
              <NavLink to="/pools" className={({ isActive }) => (isActive ? 'active' : '')}>Pools</NavLink>
              <NavLink to="/agent" className={({ isActive }) => (isActive ? 'active' : '')}>Agent</NavLink>
            </nav>
            <WalletWidget />
          </>
        )}
      </header>

      {phase !== 'ready' ? (
        <Onboarding />
      ) : (
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewDeal />} />
          <Route path="/deals" element={<MyDeals />} />
          <Route path="/deals/:dealId" element={<DealDetail />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/agent" element={<AgentStatus />} />
          <Route path="*" element={<div className="empty"><div className="big">∅</div>Nothing here.</div>} />
        </Routes>
      )}

      <footer className="muted" style={{ marginTop: 60, borderTop: '1px solid var(--line-strong)', paddingTop: 16 }}>
        Notary runs on Unicity <b>testnet2</b>. Your keys never leave this browser. Escrow decisions are made
        autonomously by the @notary agent — this site only expresses your intent over encrypted DMs.
      </footer>
    </div>
  );
}
