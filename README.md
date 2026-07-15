# Notary ⚖ autonomous escrow & arbitration on Unicity

**Notary is a trusted third party for the machine economy.** Two parties who
don't trust each other - humans, or other agents — hire `@notary` to hold funds
and settle a deal for a 1% fee. The agent is discovered on the Unicity
signed-intent market, spoken to over NIP-17 encrypted DMs with a documented JSON
protocol, funded via payment requests, and it settles every deal **by itself**:
releases, refunds, timeouts, milestone payouts, evidence-based arbitration, and
group-pool payouts. Sellers can post public **offers** so buyers discover and
open deals from a marketplace. Every deal can be a single escrow or a **staged
milestone plan** funded and released one step at a time. The agent also runs its
own treasury, self-minting working capital and rebalancing fee income.

The **web app** is the human on-ramp. A visitor gets a real client-side Unicity
wallet (keys never leave the browser), registers a nametag, self-mints test
tokens, opens a deal, funds escrow with one click when the agent's payment
request arrives, and watches settlement happen live. Crucially, humans only ever
_express intent_ — **the agent alone initiates and completes every settlement
transfer.** Nobody, including the operator, holds a "release" button.

Runs on Unicity **testnet2** (the v2 state-transition gateway) via the
[`@unicitylabs/sphere-sdk`](https://www.npmjs.com/package/@unicitylabs/sphere-sdk).

---

## Architecture

```
          ┌──────────────────────────────────────────────────────────────┐
          │                    Unicity testnet2 network                    │
          │                                                                │
          │   NIP-17 DMs   ·   payment requests   ·   NIP-29 groups   ·    │
          │   signed-intent market   ·   v2 token engine (gateway)        │
          └───────▲───────────────────▲──────────────────────▲────────────┘
                  │                    │                      │
     encrypted DMs│      payment       │  DMs / group chat    │ market intents,
     + payment    │      requests,     │  + settlement        │ swaps, mint,
     requests     │      transfers     │  transfers           │ getAssets
                  │                    │                      │
        ┌─────────┴──────────┐   ┌─────┴──────────────────────┴───────────┐
        │   packages/web     │   │            packages/agent               │
        │  React + Vite      │   │   headless Node service (@notary)       │
        │  client-side wallet│   │  ┌───────────────────────────────────┐  │
        │  • create/backup   │   │  │ pure deal state machine (tested)  │  │
        │  • self-mint UCT   │   │  │ SQLite: deals, pools, ledger,     │  │
        │  • open / fund /   │   │  │   idempotency, timers (deadlineAt) │  │
        │    confirm / dispute│  │  │ payout executor (money-safe retry) │  │
        │  • live deal.update│   │  │ pools · intents · treasury loop    │  │
        └─────────┬──────────┘   │  └───────────────────────────────────┘  │
                  │              │              │ read-only                  │
                  │  HTTP (poll) │              ▼                            │
                  └──────────────┼──▶ Fastify API: /api/status,             │
                                 │    /api/deals/:id/events, /api/protocol,  │
                                 │    /api/offers, /api/pools,               │
                                 │    /api/reputation   (NO write endpoints) │
                                 └───────────────────────────────────────────┘

  shared/  — protocol.ts: zod schemas for every DM, the deal state machine
             table, and fee math. Imported by BOTH web and agent, so the UI
             renders exactly the rules the agent enforces.
```

The API is a **read-only sidecar**. Every state change happens over the network
(DMs, payment requests, group chat) — that is the product, not an afterthought.

---

## Monorepo layout

```
notary/
├── packages/
│   ├── shared/   protocol types + zod schemas + state machine + fee math (+ tests)
│   ├── agent/    autonomous agent: state machine, deal service, pools, treasury,
│   │             intents, Fastify API, SQLite store  (+ scripts/ demos)
│   └── web/      React + Vite frontend: client wallet, deal flows, agent status
├── .env.example
├── NOTES.md      every spec-vs-real-SDK adaptation, with reasons
└── README.md
```

npm workspaces · strict TypeScript · ESM · Node ≥ 20.

---

## Quickstart

```bash
git clone <repo> notary && cd notary
cp .env.example .env            # the testnet2 gateway key is public & already filled in
npm install                     # approves better-sqlite3 + esbuild native builds

# terminal 1 — the agent (registers @notary, self-mints, opens its API on :8787)
npm run dev:agent

# terminal 2 — the web app (http://localhost:5173)
npm run dev:web
```

> **Nametag collision on a shared network:** `@notary` is first-come-first-served
> and bound to a pubkey. If someone already registered it on testnet2, set
> `NOTARY_NAMETAG=notary-<something>` in `.env` (and `VITE_NOTARY_TAG` to match)
> so your agent and web app talk to _your_ instance.

### Tests & typecheck

```bash
npm test          # shared (fee math, protocol parsing) + agent (state machine)
npm run typecheck # all three packages against the real SDK types
```

---

## Demo scripts (live testnet2)

Each demo spins up its own throwaway wallets, self-mints UCT, and narrates a full
flow against the **running agent**. Start the agent first (`npm run dev:agent`),
then:

```bash
npm run demo:two-party -w @notary/agent   # happy path: open → fund → deliver → confirm → release
npm run demo:timeout   -w @notary/agent   # refund path: fund, seller ghosts, agent auto-refunds (3-min window)
npm run demo:pool      -w @notary/agent   # NIP-29 group pool: create → 3× join/fund → creator payout
```

Expected tail of `demo:two-party`:

```
[demo] escrow FUNDED — the notary verified the transfer landed on-chain
[seller] deal.update → deal_xxxx is RELEASED
[demo] ✔ RELEASED — settlement: {"toSeller":"99000","fee":"1000","transferIds":[...]}
[demo] seller balance N → N+99000 (expected +99000)
[demo] 🎉 two-party escrow completed end-to-end on testnet2 — the agent alone moved the money.
```

`demo:timeout` ends with the buyer's balance restored by a refund the agent
issued on its own; `demo:pool` ends with the recipient receiving pot − 1% fee.

### Verified on live testnet2

All three flows and the full browser path were run end-to-end against the
testnet2 gateway during development — real tokens minted and moved:

| Flow                | Result                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two-party escrow    | `PROPOSED → AWAITING_FUNDS → FUNDED → DELIVERED_CLAIMED → RELEASED`; seller received **99000** base units, notary retained **1000** (1%). Seller balance `0 → 99000` confirmed.                   |
| Timeout refund      | Escrow funded, seller ghosted a 3-minute window; the agent **autonomously refunded** the buyer **50000** in full. Buyer balance `50000 → 100000` confirmed.                                       |
| Group pool          | `!pool create → 3 × join/fund → payout`; pot **60000**, recipient received **59400**, notary retained **600** (1%). Recipient balance `20000 → 79400` confirmed.                                  |
| Browser wallet      | Create → forced mnemonic backup → nametag registration → self-mint 100 UCT — all in headless Chrome, no page errors.                                                                              |
| Browser deal + fund | Buyer opened a deal from the UI → counterparty accepted → the **"Fund escrow" card** appeared from the agent's payment request → one click paid it → deal reached **FUNDED** live in the browser. |

The agent's `/api/status` reflects this history (deals by state, escrow volume,
treasury, pools).

---

## DM protocol reference (v1)

Send JSON as an encrypted NIP-17 DM to `@notary`. Machine-readable at
`GET /api/protocol`. Any non-JSON DM gets a plain-text `help` reply.

| Message          | Direction        | Fields                                                                                                          |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `deal.open`      | buyer → notary   | `seller`, `coinId` (hex or symbol), `deliveryHours?`; then EITHER `amount` + `deliverable` (single) OR `milestones[]` (staged); `fromOffer?` |
| `deal.invite`    | notary → seller  | `dealId`, `buyer`, `seller`, `amount`, `coinId`, `deliverable`, `deliveryHours`, `feeBps`, `acceptBy`, `milestones?`, `totalAmount?` |
| `deal.accept`    | seller → notary  | `dealId`                                                                                                      |
| `deal.reject`    | seller → notary  | `dealId`, `reason?`                                                                                           |
| `deal.delivered` | seller → notary  | `dealId`, `proof?`                                                                                            |
| `deal.confirm`   | buyer → notary   | `dealId`                                                                                                      |
| `deal.dispute`   | buyer → notary   | `dealId`, `reason?` — opens an evidence-based arbitration                                                     |
| `deal.evidence`  | party → notary   | `dealId`, `statement`, `proof?`, `proposeBuyerBps?` (sealed split proposal) — while a deal is `DISPUTED`      |
| `deal.status`    | party → notary   | `dealId`                                                                                                      |
| `deal.update`    | notary → parties | `deal` (full snapshot — the web app's live channel)                                                           |
| `offer.post`     | seller → notary  | `title`, `coinId`, `deliveryHours?`; `amount` + `deliverable` OR `milestones[]`; `expiresInDays?`             |
| `offer.close`    | seller → notary  | `offerId`                                                                                                     |
| `offer.posted`   | notary → seller  | `offerId`, `marketIntentId?` — confirmation an offer is live                                                  |
| `error`          | notary → sender  | `code`, `message`, `dealId?`                                                                                  |

### Deal state machine

```
PROPOSED ──accept──▶ AWAITING_FUNDS ──funds landed──▶ FUNDED ──delivered──▶ DELIVERED_CLAIMED
    │                     │                              │                        │
 reject/                funding                       delivery                 confirm ──▶ RELEASED (seller gets amount−fee)
 timeout                timeout                       timeout                  dispute ──▶ DISPUTED
    ▼                     ▼                              ▼               confirm-timeout ──▶ RELEASE_PENDING
CANCELLED             EXPIRED                        REFUNDED           (short appeal window; final warning)
                                                     (full refund)              │
                                                                    confirm ──▶ RELEASED
                                                                    dispute ──▶ DISPUTED
                                                                    appeal-timeout ──▶ RELEASED (silence finalizes)

DISPUTED ── evidence window ──▶ arbiter / auto-settle verdict ──▶ RESOLVED (escrow split buyer/seller, minus fee)
```

**No instant release on silence.** When the confirm window lapses the deal moves
to `RELEASE_PENDING`, not straight to `RELEASED`: a final-warning DM goes to the
buyer and a short **appeal window** (`APPEAL_WINDOW_MS`, default 24h) opens in
which they can still `deal.confirm` or `deal.dispute` before the silent release
finalizes. This protects a buyer who was simply asleep from auto-paying for junk.

**Arbitration.** A `DISPUTE` no longer auto-refunds the buyer. It opens `DISPUTED`
and an evidence window (`DISPUTE_WINDOW_MS`, default 24h). Both parties submit
`deal.evidence`, optionally attaching `proposeBuyerBps` — a **sealed** proposed
split (the buyer's share of the post-fee escrow), hidden from the counterparty
until both have proposed. If both proposals land within tolerance
(`DISPUTE_AUTO_SETTLE_TOLERANCE_BPS`, default 10%), the deal auto-settles at the
midpoint with **no arbiter** — most disputes are a price haggle, not a lie.
Otherwise an **AI arbiter** (Claude, `claude-opus-4-8`) reads the deliverable and
all evidence and returns a split — the share of the post-fee escrow to each party,
written to the public ledger with its reasoning. It rules as soon as both sides
respond, or when the window lapses. With no `ANTHROPIC_API_KEY` set it falls back
to a deterministic rule (full refund if the seller showed no evidence, else
50/50), so the agent always settles on its own.

**Staged (milestone) deals.** A `deal.open` carrying `milestones[]` instead of a
single `amount`/`deliverable` runs the same funded → delivered → released loop
**once per milestone**, funding and releasing each stage in order. Only the active
milestone is ever escrowed, so a dispute or refund touches just that stage.

The exact transition table lives in `packages/shared/src/protocol.ts` and is
unit-tested for every legal transition **and** the rejection of every illegal one.

### Marketplace (seller offers)

Sellers list public offers so buyers can discover work and open a deal from it
with the terms pre-filled. DM `@notary`:

```
offer.post   title, coinId, deliveryHours?; amount + deliverable OR milestones[]; expiresInDays?
offer.close  offerId   — take a listing down early
```

The agent curates the offer, mirrors it to the Unicity signed-intent market, and
serves it read-only at `GET /api/offers` (one at `GET /api/offers/:id`). The web
app renders these on the **Marketplace** page (`/market`); opening a deal from an
offer stamps `fromOffer` on the `deal.open` for provenance. Offers expire after
`OFFER_TTL_DAYS` (default 14) and each seller may keep up to
`MAX_OPEN_OFFERS_PER_SELLER` (default 25) open at once.

### Group pool commands (NIP-29)

DM `@notary` `!pool watch <groupId>` to invite it into a group, then in that group:

```
!pool create <amount-each> <coin> <purpose>   creator opens a pool
!pool join <id>                               contributor — agent DMs a payment request
!pool status <id>                             funding progress
!pool payout <id> @recipient                  creator only — pays pot minus fee
!pool cancel <id>                             creator only — refunds every contributor
```

Partial pools auto-refund at the deadline.

### Reputation

Every party is a registered nametag and every settlement is recorded, so the
agent computes a **track record per nametag** from its own deal history — no
extra input, nothing to fake. Served read-only:

```
GET /api/reputation          leaderboard (busiest traders)
GET /api/reputation/:tag     one nametag: deals as buyer/seller, clean
                             completions, arbitrated disputes, missed
                             deliveries, completion rate, settled volume
```

The web app shows a seller's record inline on the New-Deal form and on a
dedicated **Reputation** page, so a buyer can vet a counterparty before funding.

---

## Configuration (agent `.env`)

| Var                                       | Default                         | Meaning                                                                |
| ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `UNICITY_API_KEY`                         | _(public testnet2 key)_         | Gateway key. testnet2 key is **not** a secret; a mainnet key would be. |
| `NOTARY_NAMETAG`                          | `notary`                        | The agent's nametag (must be free on the network).                     |
| `WALLET_MNEMONIC`                         | _(unset)_                       | Pin a fixed identity; otherwise persisted in `DATA_DIR`.               |
| `DATA_DIR` / `DB_PATH`                    | `./wallet-data` / `./notary.db` | Wallet + SQLite persistence.                                           |
| `FEE_BPS` / `DISPUTE_FEE_BPS`             | `100` / `50`                    | Escrow fee / retained arbitration fee (basis points).                  |
| `ANTHROPIC_API_KEY`                       | _(unset)_                       | Enables the Claude arbiter for disputes. Unset → deterministic fallback. **A real secret.** |
| `ARBITER_MODEL`                           | `claude-opus-4-8`               | Model the AI arbiter uses.                                             |
| `DISPUTE_WINDOW_MS`                       | 24h                             | Evidence window before the arbiter rules on a dispute.                 |
| `DISPUTE_AUTO_SETTLE_TOLERANCE_BPS`       | `1000` (10%)                    | How close both sealed split proposals must be to auto-settle, no arbiter.|
| `APPEAL_WINDOW_MS`                        | 24h                             | Grace window after the confirm window lapses before the silent release. |
| `MIN_ESCROW` / `MAX_ESCROW`               | `1` / `1e24`                    | Escrow bounds (base units; 1e24 ≈ 1,000,000 UCT).                       |
| `MAX_MILESTONES`                          | `12`                            | Cap on milestones per staged deal.                                     |
| `ACCEPT_/FUNDING_/CONFIRM_TIMEOUT_MS`     | 1h / 24h / 48h                  | Deal timers.                                                           |
| `DEFAULT_DELIVERY_HOURS`                  | `72`                            | Delivery window when the buyer omits one.                             |
| `OFFER_TTL_DAYS` / `MAX_OPEN_OFFERS_PER_SELLER` | `14` / `25`               | Marketplace offer lifetime and per-seller listing cap.                 |
| `TREASURY_FLOOR` / `TREASURY_MINT_AMOUNT` | `1e18` / `1e19`                 | Self-mint trigger (< 1 UCT) + amount (10 UCT).                          |
| `TREASURY_THRESHOLD` / `PREFERRED_COIN`   | `1e20` / `UCT`                  | Rebalance non-preferred coin above threshold (100 UCT).                 |
| `TREASURY_AUTO_SWAP`                      | `false`                         | SDK P2P swaps need the experimental accounting module (see NOTES §5).  |
| `API_PORT`                                | `8787`                          | Read-only API port (honours `PORT` on PaaS).                           |

Web app env (`VITE_*`): `VITE_UNICITY_API_KEY`, `VITE_NOTARY_TAG`, `VITE_AGENT_API`.

---

## Troubleshooting

- **"nametag is taken and this wallet does not own it"** — someone else holds
  `@notary` on testnet2, or your `DATA_DIR` was wiped (new keypair). Restore
  `wallet-data/` or set `WALLET_MNEMONIC`, or pick a fresh `NOTARY_NAMETAG`.
- **Mint fails / `AGGREGATOR_ERROR`** — bad or missing `UNICITY_API_KEY`, or
  you're pointed at mainnet/dev (only testnet2 serves the v2 engine).
- **Web wallet won't send** — the wallet-api rails must be composed on top of the
  base providers (both packages do this via `createWalletApiProviders`; see NOTES §1).
- **Payment request never shows in the UI** — it arrives over the wallet-api
  cursor; the app polls `syncPaymentRequests()` every few seconds (NOTES §4).
- **Storage wiped mid-deal** — the agent rehydrates every timer from persisted
  `deadlineAt` timestamps in SQLite and resumes on restart; the browser keeps
  deal snapshots in localStorage and re-fetches the public event trail.

---

## Roadmap

Notary is complete and verified end-to-end on **testnet2**. What's next, roughly
in order:

**Now → next**

- **Mainnet launch.** Harden secret handling (a mainnet gateway key _is_ a
  secret), then run the same flows against mainnet with real UCT and a real fee.
- **Treasury auto-swap.** Turn `TREASURY_AUTO_SWAP` on by default once the SDK's
  P2P swap path leaves the experimental accounting module (see NOTES §5); today
  the agent only publishes signed swap intents to the market.
- **Deal event webhooks / push.** Let integrators subscribe to `deal.update`
  over a webhook or push channel instead of polling `/api/deals/:id/events`.

**Later**

- **Human arbiter escalation.** An optional appeal from the AI arbiter's split to
  a human panel when a party contests the verdict, with the same public-ledger
  reasoning trail.
- **Portable reputation.** Sign and export the per-nametag track record so it
  travels across agents and can be verified independently of any one instance.
- **Richer proofs.** Content-addressed deliverable attachments referenced from
  `deal.evidence`, so arbitration reads the artifact, not just a URL.
- **Threshold group pools.** n-of-m approvals for pool payouts, beyond the
  current creator-only model.

---

## Deployment

- **Agent** → any always-on Node host (Railway / Fly / Render). Persist
  `DATA_DIR` and `DB_PATH` on a volume so the identity and deals survive
  restarts. Set the env vars above; expose `API_PORT`.
- **Web** → static build (`npm run build -w @notary/web`), deploy `dist/` to
  Vercel / Netlify / any static host. Set `VITE_*` at build time; point
  `VITE_AGENT_API` at the deployed agent's API URL.

MIT.
