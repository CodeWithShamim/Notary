import { Route, Routes } from 'react-router-dom';
import { useConnect } from './state/ConnectContext.js';
import { Onboarding } from './components/Onboarding.js';
import { Navbar } from './components/Navbar.js';
import { Home } from './pages/Home.js';
import { NewDeal } from './pages/NewDeal.js';
import { MyDeals } from './pages/MyDeals.js';
import { DealDetail } from './pages/DealDetail.js';
import { AgentStatus } from './pages/AgentStatus.js';
import { Pools } from './pages/Pools.js';

export default function App() {
  const { phase } = useConnect();
  const connected = phase === 'connected';

  return (
    <div className="app">
      {connected ? (
        <Navbar />
      ) : (
        <header className="topbar">
          <div className="wordmark">
            <span className="seal">⚖</span> Notary
          </div>
        </header>
      )}

      {!connected ? (
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
