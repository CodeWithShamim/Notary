# NOTES.md — spec → real-SDK adaptations

Every place where the build spec's assumptions differed from the real
`@unicitylabs/sphere-sdk` (v0.11.9) API, and what we did about it.
Source of truth: `node_modules/@unicitylabs/sphere-sdk/README.md` + `dist/*.d.ts`.

## 1. Provider setup is TWO layers, not one

The spec said "Agent uses `createNodeProviders`, web uses `createBrowserProviders`".
In SDK ≥0.11 those build only the **base** (storage + Nostr transport + oracle).
A wallet composed from the base alone **silently cannot send or receive v2
transfers** — the delivery (mailbox) and token-storage ports come from a second
layer:

```ts
const base = createNodeProviders({ network: 'testnet', dataDir, oracle: { apiKey } });
const providers = createWalletApiProviders(base, {
  baseUrl: 'https://wallet-api.unicity.network', // testnet2 wallet-api
  network: 'testnet2',
  deviceId: '<persisted stable id>',             // avoids re-auth per boot
});
await Sphere.init({ ...providers, ... });
```

Both agent and web do this. `deviceId` is persisted (agent: SQLite kv; web:
localStorage) so restarts resume the wallet-api session instead of a fresh
challenge sign-in.

## 2. `CERTIFICATION_UNCONFIRMED` is not retryable (money safety)

The spec said "all settlement payments retried with backoff". The SDK
documents one send failure mode — `ProofUnconfirmedError`
(`code: 'CERTIFICATION_UNCONFIRMED'`) — where the spend **may already be
on-chain**. Re-issuing `send()` there double-pays the recipient. Our payout
executor therefore:

- retries with backoff **only** on errors that are safe to retry;
- on `CERTIFICATION_UNCONFIRMED`, marks the payout `unconfirmed` and relies on
  `sphere.payments.resumeOpenIntents()` (called on boot and every few minutes,
  as the SDK prescribes for long-running bots) to complete it under the same
  transferId; the payout row is reconciled when the intent resolves.

## 3. Payments require a *published identity*; DM pubkeys are not payable

`DirectMessage.senderPubkey` is the transport-level (Nostr/HKDF) pubkey — you
can DM it back, but you cannot `send()` money to it. Payments resolve
`@nametag` (or chain pubkey / DIRECT://) only. Consequences:

- Both buyer and seller **must have a registered nametag**. `deal.open` from a
  sender with no resolvable nametag is rejected with `UNRESOLVABLE_PARTY`.
  The web app enforces nametag registration before the New-Deal form unlocks.
- Party identity in a deal = transport pubkey (stable per wallet, used to
  authenticate later DMs) **plus** captured nametag (used for payouts).
- Buyer nametag is taken from `msg.senderNametag`, falling back to
  `communications.resolvePeerNametag(senderPubkey)`.

## 4. Funding verification

Spec: "verify via response tracking + confirm transfer landed". Real API:
`sendPaymentRequest(recipient, { amount, coinId, message, metadata })` returns
`requestId`; the payer's wallet answers with a `PaymentRequestResponse`
(`responseType: 'paid'`, `transferId`).

**Two real-API findings, verified against live testnet2:**

1. **Payment-request `metadata` is dropped on the wire.** We pass
   `metadata: { dealId }`, but on the receiving wallet
   `IncomingPaymentRequest.metadata` comes back `undefined` (confirmed with a
   probe against testnet2). The **agent side is unaffected** — it correlates the
   `paid` response by its stored `requestId` (`getDealByPaymentRequest`), not
   metadata. The **payer side** (demo + web) therefore identifies which deal a
   pending request belongs to by the `message` text, into which the agent embeds
   the dealId (`"Escrow funding for deal <id>: …"`).

2. **Requests arrive over the wallet-api cursor, not the live Nostr handler.**
   `onPaymentRequest(...)` did not fire in practice, but
   `syncPaymentRequests()` + `getPaymentRequests({ status: 'pending' })`
   surfaced the request every time. So both the demos and the web app **poll
   `syncPaymentRequests()`** rather than trusting the live callback.

We then confirm the money actually landed (`getHistory` RECEIVED entry ≥ the
deal amount + `pumpIncomingDeliveries`) before transitioning to FUNDED — the
`paid` response is a claim, not proof.

## 5. Treasury rebalancing: market intent first, SDK swap not usable in v1

`sphere.swap` exists but is a *client* of an external swap-escrow service and
is built on the SDK's **experimental accounting/invoicing module** — which the
spec explicitly forbids using. Depending on it would also make the demo flaky
(needs a live third-party escrow + counterparty). Adaptation:

- The treasury loop measures fee holdings via `getAssets()`; above threshold it
  **publishes a signed swap intent on the market**
  (`sphere.market.postIntent({ intentType: 'sell', ... })`) offering the
  non-preferred coin for the preferred one — the spec's sanctioned fallback —
  and ledgers the action.
- Incoming `swap:proposal_received` events are logged and surfaced over the
  API, but auto-accepting SDK swaps stays off by default
  (`TREASURY_AUTO_SWAP=false`) because accepting requires the accounting
  module. This is stated honestly in SUBMISSION.md.

## 6. Group-chat API differences

`gc.sendMessage(groupId, content, replyToId?)` takes positional args in 0.11.9
(README shows an options object — the `.d.ts` wins). `fetchMessages(groupId,
since?, limit?)` likewise. Pool commands parse `message.content` from
`gc.onMessage`; the "creator" of a pool is `senderPubkey` of the `!pool create`
message (NIP-29 pubkey), and `!pool payout` / `!pool cancel` verify it.

**NIP-29 relay auth (verified on testnet2).** `sphere-relay.unicity.network`
requires NIP-42 auth. Two consequences the demo has to handle:

- `createGroup()` can be published *before* the AUTH handshake settles and gets
  rejected with `auth-required`. Fix: wait a few seconds after `connect()` and
  retry create.
- After the agent auto-joins via `!pool watch <groupId>`, its **group** greeting
  can lag in propagating to the group creator, but the agent's confirmation
  **DM** ("Watching group …") is reliable — so the demo gates on that DM, not the
  in-group greeting, before proceeding. Once all members' subscriptions settle
  (a short delay), the full `!pool create → join → fund → payout` round-trip works
  end-to-end (verified: pot 60000, payout 59400, 600 fee).

## 7. Amounts

`send()` / `sendPaymentRequest()` take **smallest-unit decimal strings**;
`mintFungibleToken(coinIdHex, amount)` takes **bigint**. `Asset.totalAmount`
is a smallest-unit string; `Asset.decimals` drives display via
`toHumanReadable`. The shared protocol carries smallest-unit strings
end-to-end and converts only at the UI edge — no floats anywhere.

## 8. API key + endpoints

The npm package does not ship `.env.example`; the public testnet2 gateway key
is published in the SDK README (`sk_ddc3cfcc001e4a28ac3fad7407f99590`, stated
there to be non-secret). We keep it as the documented default in our
`.env.example` with the same "testnet2-only; a mainnet key IS a secret" note.
Endpoints used (from the SDK's `testnet` preset): gateway
`gateway.testnet2.unicity.network`, wallet-api `wallet-api.unicity.network`,
DM relay `nostr-relay.testnet.unicity.network`, NIP-29 relay
`sphere-relay.unicity.network`, market `market-api.unicity.network`.

## 9. Better-sqlite3 on Node 26

better-sqlite3@11 (spec-era) does not compile against Node 26's V8; pinned to
`^12` which ships prebuilds/compiles cleanly. No API change.

## 10. Market module must be enabled at init

`sphere.market` is undefined unless `Sphere.init` gets `market: true` (same
for `groupChat`). `postIntent` auto-registers the agent on first post.
`PostIntentRequest.price` is a JS number (display-only, not money math) — fee
advertised as `1` (percent) in the intent text instead of trusting float math.

## 11. DealSnapshot `seller` is empty until acceptance

Caught during live browser testing: a `PROPOSED` deal has no seller pubkey yet
(the seller is only pinned when they first message), so the snapshot's `seller`
field is `""`. The zod schema originally required a non-empty party ref, which
made the *first* `deal.update` fail validation on the receiver — the web app's
"My deals" stayed empty until the seller accepted. `DealSnapshot.buyer/seller`
are now `z.string()` (empty allowed). The tags (`buyerTag`/`sellerTag`) carry the
human identity throughout.

## 12. No `.d.ts` for `impl/browser`

The 0.11.9 package ships types for `impl/nodejs` but not `impl/browser`. The web
package declares a minimal ambient module (`src/types/sphere-browser.d.ts`)
mirroring the Node providers' shape (`storage`/`transport`/`oracle`/`tokenStorage`
+ optional `price`/`market`/`groupChat`). Runtime is unaffected.

## 13. Browser needs a Buffer polyfill

Vite externalizes Node's built-in `buffer`, but the SDK's crypto path expects a
global `Buffer`. The web entrypoint assigns `globalThis.Buffer` from the `buffer`
package before any SDK code runs; without it, wallet init warns and some ops
fail.

## 14. `getCoinIdBySymbol` is empty until the registry loads

The SDK fetches the token registry asynchronously around `Sphere.init`, so
`getCoinIdBySymbol('UCT')` returns `undefined` if called at module-load time.
The web resolves it lazily (`uctCoinId()`) with the stable testnet2 UCT hex id as
a fallback. (This also means UCT has **18 decimals**: escrow bounds and treasury
thresholds are set in whole-UCT terms — `MAX_ESCROW` = 1e24 base units.)

## 15. Ephemeral DM mode

As the spec assumed: `communications: { cacheMessages: false }` disables SDK
dedup, so the agent keeps its own idempotency table keyed
`(message.id, senderPubkey)` in SQLite; every handler is idempotent and
re-delivery is a no-op. `dmSince` is set a few minutes back on boot so DMs
sent while the agent was briefly down are still picked up (idempotency table
absorbs the overlap).
