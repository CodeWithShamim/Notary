import { useState } from 'react';
import { Route, Routes, Link, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar.js';
import { BookIcon } from './components/Icon.js';
import { SignaturePrompt } from './components/SignaturePrompt.js';
import { BootLoader } from './components/BootLoader.js';
import { FileQuestionIcon } from './components/Icon.js';
import { PageTransition } from './components/PageTransition.js';
import { RouteProgressBar } from './components/loaders/index.js';
import { Home } from './pages/Home.js';
import { NewDeal } from './pages/NewDeal.js';
import { MyDeals } from './pages/MyDeals.js';
import { DealDetail } from './pages/DealDetail.js';
import { AgentStatus } from './pages/AgentStatus.js';
import { Pools } from './pages/Pools.js';
import { Reputation } from './pages/Reputation.js';
import { Docs } from './pages/Docs.js';

export default function App() {
  // Show the boot overlay once per browser tab session.
  const [booted, setBooted] = useState(() => sessionStorage.getItem('notary:booted') === '1');

  if (!booted) {
    return (
      <BootLoader
        onDone={() => {
          sessionStorage.setItem('notary:booted', '1');
          setBooted(true);
        }}
      />
    );
  }

  return (
    <div className="app">
      <RouteProgressBar />
      <Navbar />

      <PageTransition>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewDeal />} />
          <Route path="/deals" element={<MyDeals />} />
          <Route path="/deals/:dealId" element={<DealDetail />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/reputation" element={<Reputation />} />
          <Route path="/agent" element={<AgentStatus />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<div className="empty"><div className="big"><FileQuestionIcon size={40} /></div>Nothing here.</div>} />
        </Routes>
      </PageTransition>

      <footer className="muted app-footer">
        Notary runs on Unicity <b>testnet2</b>. Your keys never leave this browser. Escrow decisions are made
        autonomously by the @notary agent - this site only expresses your intent over encrypted DMs.
      </footer>

      <SignaturePrompt />
      <DocsFab />
    </div>
  );
}

/** Floating docs shortcut, pinned bottom-right. Hidden while on /docs. */
function DocsFab() {
  const { pathname } = useLocation();
  if (pathname === '/docs') return null;
  return (
    <Link to="/docs" className="docs-fab" aria-label="Documentation" title="Documentation">
      <BookIcon size={22} />
    </Link>
  );
}
