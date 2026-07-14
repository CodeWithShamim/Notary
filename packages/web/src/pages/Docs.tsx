import { useEffect, useState } from 'react';
import { PageLayout } from '../components/PageLayout.js';

/** Table-of-contents entries — id must match a `<section id>` below. */
const TOC: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'concepts', label: 'Core concepts' },
  { id: 'lifecycle', label: 'Deal lifecycle' },
  { id: 'protocol', label: 'DM protocol' },
  { id: 'pools', label: 'Group pools' },
  { id: 'fees', label: 'Fees & timers' },
  { id: 'api', label: 'Read-only API' },
  { id: 'config', label: 'Configuration' },
  { id: 'security', label: 'Security model' },
  { id: 'faq', label: 'Troubleshooting' },
];

/** DM protocol message catalogue — mirrors packages/shared/src/protocol.ts. */
const MESSAGES: { name: string; dir: string; fields: string }[] = [
  { name: 'deal.open', dir: 'buyer → notary', fields: 'seller, amount, coinId, deliverable, deliveryHours?' },
  { name: 'deal.invite', dir: 'notary → seller', fields: 'dealId, buyer, seller, amount, coinId, deliverable, deliveryHours, feeBps, acceptBy' },
  { name: 'deal.accept', dir: 'seller → notary', fields: 'dealId' },
  { name: 'deal.reject', dir: 'seller → notary', fields: 'dealId, reason?' },
  { name: 'deal.delivered', dir: 'seller → notary', fields: 'dealId, proof?' },
  { name: 'deal.confirm', dir: 'buyer → notary', fields: 'dealId' },
  { name: 'deal.dispute', dir: 'buyer → notary', fields: 'dealId, reason?' },
  { name: 'deal.status', dir: 'party → notary', fields: 'dealId' },
  { name: 'deal.update', dir: 'notary → parties', fields: 'deal (full snapshot — the web app’s live channel)' },
  { name: 'error', dir: 'notary → sender', fields: 'code, message, dealId?' },
];

/** Protocol error codes — mirrors ErrorCode in protocol.ts. */
const ERRORS: { code: string; meaning: string }[] = [
  { code: 'BAD_MESSAGE', meaning: 'The DM was not valid JSON or failed schema validation.' },
  { code: 'UNKNOWN_DEAL', meaning: 'No deal exists for the given dealId.' },
  { code: 'NOT_YOUR_DEAL', meaning: 'You are neither the buyer nor the seller on that deal.' },
  { code: 'ILLEGAL_TRANSITION', meaning: 'The action is not legal from the deal’s current state.' },
  { code: 'UNRESOLVABLE_PARTY', meaning: 'A nametag or address could not be resolved on the network.' },
  { code: 'AMOUNT_OUT_OF_RANGE', meaning: 'The amount is below MIN_ESCROW or above MAX_ESCROW.' },
  { code: 'UNSUPPORTED_COIN', meaning: 'The coinId / symbol is not recognised.' },
  { code: 'INTERNAL', meaning: 'The agent hit an unexpected error while handling the message.' },
];

const CONFIG: { name: string; def: string; meaning: string }[] = [
  { name: 'UNICITY_API_KEY', def: 'public testnet2 key', meaning: 'Gateway key. The testnet2 key is not a secret; a mainnet key would be.' },
  { name: 'NOTARY_NAMETAG', def: 'notary', meaning: 'The agent’s nametag. Must be free on the network.' },
  { name: 'WALLET_MNEMONIC', def: 'unset', meaning: 'Pin a fixed identity; otherwise persisted in DATA_DIR.' },
  { name: 'DATA_DIR / DB_PATH', def: './wallet-data / ./notary.db', meaning: 'Wallet + SQLite persistence paths.' },
  { name: 'FEE_BPS / DISPUTE_FEE_BPS', def: '100 / 50', meaning: 'Escrow fee / retained dispute fee, in basis points.' },
  { name: 'MIN_ESCROW / MAX_ESCROW', def: '1 / 1e15', meaning: 'Escrow bounds, in base units.' },
  { name: 'ACCEPT / FUNDING / CONFIRM_TIMEOUT_MS', def: '1h / 24h / 48h', meaning: 'Deal timers.' },
  { name: 'DEFAULT_DELIVERY_HOURS', def: '72', meaning: 'Delivery window when the buyer omits one.' },
  { name: 'TREASURY_FLOOR / TREASURY_MINT_AMOUNT', def: '1000 / 100000', meaning: 'Self-mint trigger + amount.' },
  { name: 'TREASURY_THRESHOLD / PREFERRED_COIN', def: '10000 / UCT', meaning: 'Rebalance a non-preferred coin above the threshold.' },
  { name: 'TREASURY_AUTO_SWAP', def: 'false', meaning: 'SDK P2P swaps need the experimental accounting module.' },
  { name: 'API_PORT', def: '8787', meaning: 'Port for the read-only API.' },
];

/** Highlights the active TOC entry as the reader scrolls through sections. */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? '');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

export function Docs() {
  const active = useActiveSection(TOC.map((t) => t.id));

  const aside = (
    <nav className="docs-toc" aria-label="Documentation sections">
      <div className="aside-title">On this page</div>
      <ul>
        {TOC.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`} className={active === t.id ? 'active' : ''}>
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <PageLayout aside={aside}>
      <div className="docs">
        <h1>Documentation</h1>
        <p className="sub">
          Notary is a trusted third party for the machine economy: an autonomous escrow &amp; arbitration agent
          on Unicity <b>testnet2</b>, plus a web on-ramp for humans. This page covers the full protocol, the
          deal lifecycle the agent enforces, and everything you need to run or integrate with it.
        </p>

        {/* ── Overview ─────────────────────────────────────────── */}
        <section id="overview" className="doc-section">
          <h2>Overview</h2>
          <p>
            Two parties who don&rsquo;t trust each other &mdash; humans, or other agents &mdash; hire{' '}
            <code>@notary</code> to hold funds and settle a deal for a 1% fee. The agent is discovered on the
            Unicity signed-intent market, spoken to over NIP-17 encrypted DMs with a documented JSON protocol,
            funded via payment requests, and it settles every deal <b>by itself</b>: releases, refunds,
            timeouts, disputes, and group-pool payouts.
          </p>
          <p>
            The web app is the human on-ramp. A visitor gets a real client-side Unicity wallet (keys never
            leave the browser), registers a nametag, self-mints test tokens, opens a deal, funds escrow with one
            click when the agent&rsquo;s payment request arrives, and watches settlement happen live. Humans
            only ever <b>express intent</b> &mdash; the agent alone initiates and completes every settlement
            transfer. Nobody, including the operator, holds a &ldquo;release&rdquo; button.
          </p>
          <div className="callout">
            <b>Read-only sidecar.</b> The HTTP API exposes status and event trails only. Every state change
            happens over the network (DMs, payment requests, group chat) &mdash; that is the product, not an
            afterthought. There are no write endpoints.
          </div>
        </section>

        {/* ── Quickstart ───────────────────────────────────────── */}
        <section id="quickstart" className="doc-section">
          <h2>Quickstart</h2>
          <p>The agent and web app are npm workspaces. Node &ge; 20, strict TypeScript, ESM.</p>
          <pre className="json">{`git clone <repo> notary && cd notary
cp .env.example .env      # the testnet2 gateway key is public & already filled in
npm install               # approves better-sqlite3 + esbuild native builds

# terminal 1 — the agent (registers @notary, self-mints, opens its API on :8787)
npm run dev:agent

# terminal 2 — the web app (http://localhost:5173)
npm run dev:web`}</pre>
          <div className="callout warn">
            <b>Nametag collision on a shared network.</b> <code>@notary</code> is first-come-first-served and
            bound to a pubkey. If someone already registered it on testnet2, set{' '}
            <code>NOTARY_NAMETAG=notary-&lt;something&gt;</code> in <code>.env</code> (and{' '}
            <code>VITE_NOTARY_TAG</code> to match) so your agent and web app talk to <i>your</i> instance.
          </div>
          <h3>Tests &amp; typecheck</h3>
          <pre className="json">{`npm test          # shared (fee math, protocol parsing) + agent (state machine)
npm run typecheck # all three packages against the real SDK types`}</pre>
          <h3>Demo scripts (live testnet2)</h3>
          <p>Each demo spins up throwaway wallets, self-mints UCT, and narrates a full flow against the running agent.</p>
          <pre className="json">{`npm run demo:two-party -w @notary/agent   # open → fund → deliver → confirm → release
npm run demo:timeout   -w @notary/agent   # fund, seller ghosts, agent auto-refunds
npm run demo:pool      -w @notary/agent   # group pool: create → 3× join/fund → payout`}</pre>
        </section>

        {/* ── Core concepts ────────────────────────────────────── */}
        <section id="concepts" className="doc-section">
          <h2>Core concepts</h2>
          <div className="doc-cards">
            <div className="card">
              <h3>Escrow deal</h3>
              <p>
                A one-to-one agreement between a <b>buyer</b> and a <b>seller</b> for an <code>amount</code> of a
                coin against a <code>deliverable</code>. The agent takes custody of the funds and releases,
                refunds, or splits them based on what the parties (and the clock) do.
              </p>
            </div>
            <div className="card">
              <h3>The agent (@notary)</h3>
              <p>
                A headless Node service with its own Unicity wallet. It resolves nametags, verifies on-chain
                funding, runs a tested deal state machine, and executes every payout itself with money-safe
                retries. It also runs its own treasury &mdash; self-minting working capital.
              </p>
            </div>
            <div className="card">
              <h3>Client-side wallet</h3>
              <p>
                The web app creates a real Unicity wallet in the browser; the mnemonic never leaves the page.
                Users register a nametag, self-mint test UCT, and sign every transfer locally. The app only
                sends encrypted DMs expressing intent.
              </p>
            </div>
            <div className="card">
              <h3>Shared protocol</h3>
              <p>
                <code>packages/shared/protocol.ts</code> holds the zod schemas for every DM, the deal state
                machine table, and the fee math. Both the web app and the agent import it, so the UI renders
                exactly the rules the agent enforces.
              </p>
            </div>
          </div>
        </section>

        {/* ── Lifecycle ────────────────────────────────────────── */}
        <section id="lifecycle" className="doc-section">
          <h2>Deal lifecycle</h2>
          <p>
            Every deal walks a state machine. The exact transition table lives in{' '}
            <code>packages/shared/src/protocol.ts</code> and is unit-tested for every legal transition <b>and</b>{' '}
            the rejection of every illegal one.
          </p>
          <pre className="json">{`PROPOSED ──accept──▶ AWAITING_FUNDS ──funds landed──▶ FUNDED ──delivered──▶ DELIVERED_CLAIMED
   │                    │                              │                        │
reject/               funding                       delivery                 confirm ─▶ RELEASED  (seller gets amount − fee)
timeout               timeout                       timeout                  dispute ─▶ REFUNDED  (buyer gets amount − dispute fee)
   ▼                    ▼                              ▼                      timeout ─▶ RELEASED  (silence = acceptance)
CANCELLED            EXPIRED                        REFUNDED (full refund)`}</pre>
          <table className="clean">
            <thead>
              <tr><th>State</th><th>Meaning</th></tr>
            </thead>
            <tbody>
              <tr><td className="mono">PROPOSED</td><td>Buyer opened the deal; the notary invited the seller and is waiting for accept/reject.</td></tr>
              <tr><td className="mono">AWAITING_FUNDS</td><td>Seller accepted; the notary sent the buyer a payment request and is watching for funds.</td></tr>
              <tr><td className="mono">FUNDED</td><td>Escrow is confirmed on-chain. The seller can begin work.</td></tr>
              <tr><td className="mono">DELIVERED_CLAIMED</td><td>Seller marked the work delivered. Buyer can confirm or dispute; silence releases at the deadline.</td></tr>
              <tr><td className="mono">RELEASED</td><td>Terminal. Seller received <code>amount − fee</code>; the notary retained the fee.</td></tr>
              <tr><td className="mono">REFUNDED</td><td>Terminal. Buyer refunded (full on timeout, or <code>amount − dispute fee</code> on dispute).</td></tr>
              <tr><td className="mono">CANCELLED</td><td>Terminal. Seller rejected, or the accept window elapsed.</td></tr>
              <tr><td className="mono">EXPIRED</td><td>Terminal. The funding window elapsed before escrow landed.</td></tr>
            </tbody>
          </table>
          <div className="callout">
            <b>Crash-safe timers.</b> The agent rehydrates every timer from persisted <code>deadlineAt</code>{' '}
            timestamps in SQLite and resumes on restart, so a deal never gets stuck if the process bounces.
          </div>
        </section>

        {/* ── Protocol ─────────────────────────────────────────── */}
        <section id="protocol" className="doc-section">
          <h2>DM protocol reference (v1)</h2>
          <p>
            Send JSON as an encrypted NIP-17 DM to <code>@notary</code>. The machine-readable schema is served
            at <code>GET /api/protocol</code>. Any non-JSON DM gets a plain-text <code>help</code> reply.
          </p>
          <div className="table-scroll">
            <table className="clean">
              <thead>
                <tr><th>Message</th><th>Direction</th><th>Fields</th></tr>
              </thead>
              <tbody>
                {MESSAGES.map((m) => (
                  <tr key={m.name}>
                    <td className="mono">{m.name}</td>
                    <td className="muted">{m.dir}</td>
                    <td>{m.fields}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="doc-note">
            <code>amount</code> is a base-unit integer <i>string</i>. <code>coinId</code> accepts a hex id or a
            symbol like <code>UCT</code>. Fields ending in <code>?</code> are optional.
          </p>

          <h3>Example: opening a deal</h3>
          <pre className="json">{`{
  "type": "deal.open",
  "seller": "@alice",
  "amount": "100000",
  "coinId": "UCT",
  "deliverable": "Logo design, 3 concepts + source files",
  "deliveryHours": 72
}`}</pre>

          <h3>Error codes</h3>
          <table className="clean">
            <thead>
              <tr><th>Code</th><th>Meaning</th></tr>
            </thead>
            <tbody>
              {ERRORS.map((e) => (
                <tr key={e.code}>
                  <td className="mono">{e.code}</td>
                  <td>{e.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── Pools ────────────────────────────────────────────── */}
        <section id="pools" className="doc-section">
          <h2>Group pools (NIP-29)</h2>
          <p>
            Escrow for groups: everyone chips in the same amount inside a NIP-29 group chat; the creator pays
            the pot out (minus the notary fee) or cancels for a full refund. Partial pools auto-refund at the
            deadline. DM <code>!pool watch &lt;groupId&gt;</code> to <code>@notary</code> to invite it into a
            group, then in that group:
          </p>
          <pre className="json">{`!pool create <amount-each> <coin> <purpose>   creator opens a pool
!pool join <id>                               contributor — agent DMs a payment request
!pool status <id>                             funding progress
!pool payout <id> @recipient                  creator only — pays pot minus fee
!pool cancel <id>                             creator only — refunds every contributor`}</pre>
          <p className="doc-note">
            Live pools are visible on the <a href="/pools">Pools</a> page, backed by <code>GET /api/pools</code>.
          </p>
        </section>

        {/* ── Fees & timers ────────────────────────────────────── */}
        <section id="fees" className="doc-section">
          <h2>Fees &amp; timers</h2>
          <p>
            Fees are basis points (bps) of the escrow amount; 100 bps = 1%. On a normal release the seller
            receives <code>amount − fee</code>. On a dispute the notary retains a smaller dispute fee and
            refunds the rest to the buyer. A timeout refund is <b>full</b> &mdash; no fee is taken when the
            counterparty simply never showed up.
          </p>
          <div className="doc-cards">
            <div className="card">
              <h3>Fee math</h3>
              <ul className="doc-list">
                <li><b>Escrow fee</b> &mdash; <code>FEE_BPS</code>, default 100 (1%).</li>
                <li><b>Dispute fee</b> &mdash; <code>DISPUTE_FEE_BPS</code>, default 50 (0.5%).</li>
                <li>Release split: seller = <code>amount − fee</code>, notary = <code>fee</code>.</li>
                <li>Dispute split: buyer = <code>amount − dispute fee</code>, notary = <code>dispute fee</code>.</li>
              </ul>
            </div>
            <div className="card">
              <h3>Default timers</h3>
              <ul className="doc-list">
                <li><b>Accept</b> &mdash; 1h for the seller to accept or reject.</li>
                <li><b>Funding</b> &mdash; 24h for the buyer to fund escrow.</li>
                <li><b>Delivery</b> &mdash; 72h default (buyer can override per deal).</li>
                <li><b>Confirm</b> &mdash; 48h; silence past this releases to the seller.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ── API ──────────────────────────────────────────────── */}
        <section id="api" className="doc-section">
          <h2>Read-only API</h2>
          <p>
            A Fastify sidecar on <code>API_PORT</code> (default <code>8787</code>) serves observability only.
            There are <b>no write endpoints</b> &mdash; all state changes go over the network.
          </p>
          <table className="clean">
            <thead>
              <tr><th>Endpoint</th><th>Returns</th></tr>
            </thead>
            <tbody>
              <tr><td className="mono">GET /api/status</td><td>Identity, uptime, fees, deals-by-state, escrow volume, treasury, pools, timers.</td></tr>
              <tr><td className="mono">GET /api/deals/:id/events</td><td>The public event trail for one deal (state, amount, timestamps, events).</td></tr>
              <tr><td className="mono">GET /api/protocol</td><td>Machine-readable JSON schema for every DM message type.</td></tr>
              <tr><td className="mono">GET /api/pools</td><td>All tracked group pools with funding progress.</td></tr>
            </tbody>
          </table>
          <p className="doc-note">
            The <a href="/agent">Agent</a> page renders <code>/api/status</code> live; individual deals surface
            their <code>/api/deals/:id/events</code> trail.
          </p>
        </section>

        {/* ── Configuration ────────────────────────────────────── */}
        <section id="config" className="doc-section">
          <h2>Configuration</h2>
          <p>The agent is configured via <code>.env</code>. Sensible defaults ship in <code>.env.example</code>.</p>
          <div className="table-scroll">
            <table className="clean">
              <thead>
                <tr><th>Variable</th><th>Default</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {CONFIG.map((c) => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td className="muted">{c.def}</td>
                    <td>{c.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="doc-note">
            Web app env (<code>VITE_*</code>): <code>VITE_UNICITY_API_KEY</code>, <code>VITE_NOTARY_TAG</code>,{' '}
            <code>VITE_AGENT_API</code>.
          </p>
        </section>

        {/* ── Security ─────────────────────────────────────────── */}
        <section id="security" className="doc-section">
          <h2>Security model</h2>
          <ul className="doc-list">
            <li>
              <b>Keys never leave the browser.</b> The web wallet is fully client-side; the mnemonic is stored
              locally and every transfer is signed on the device.
            </li>
            <li>
              <b>No release button.</b> Humans only express intent over encrypted DMs. The agent alone initiates
              and completes every settlement transfer on-chain &mdash; the operator cannot move escrowed funds.
            </li>
            <li>
              <b>Verified funding.</b> A deal only advances to <code>FUNDED</code> after the notary confirms the
              transfer actually landed on-chain, not on the buyer&rsquo;s say-so.
            </li>
            <li>
              <b>Idempotent, money-safe payouts.</b> The payout executor is retry-safe and idempotency-keyed, so
              a crash mid-settlement never double-pays.
            </li>
            <li>
              <b>testnet2 keys are not secrets.</b> The public gateway key ships in <code>.env.example</code>.
              A mainnet key would be a secret and must never be committed.
            </li>
          </ul>
        </section>

        {/* ── Troubleshooting ──────────────────────────────────── */}
        <section id="faq" className="doc-section">
          <h2>Troubleshooting</h2>
          <div className="doc-faq">
            <div>
              <h3>&ldquo;nametag is taken and this wallet does not own it&rdquo;</h3>
              <p>
                Someone else holds <code>@notary</code> on testnet2, or your <code>DATA_DIR</code> was wiped
                (new keypair). Restore <code>wallet-data/</code> or set <code>WALLET_MNEMONIC</code>, or pick a
                fresh <code>NOTARY_NAMETAG</code>.
              </p>
            </div>
            <div>
              <h3>Mint fails / <code>AGGREGATOR_ERROR</code></h3>
              <p>
                Bad or missing <code>UNICITY_API_KEY</code>, or you&rsquo;re pointed at mainnet/dev. Only
                testnet2 serves the v2 state-transition engine.
              </p>
            </div>
            <div>
              <h3>Payment request never shows in the UI</h3>
              <p>
                It arrives over the wallet-api cursor; the app polls <code>syncPaymentRequests()</code> every
                few seconds. Give it a moment, and confirm the wallet is connected.
              </p>
            </div>
            <div>
              <h3>Storage wiped mid-deal</h3>
              <p>
                The agent rehydrates every timer from persisted <code>deadlineAt</code> timestamps in SQLite and
                resumes on restart; the browser keeps deal snapshots in localStorage and re-fetches the public
                event trail.
              </p>
            </div>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
