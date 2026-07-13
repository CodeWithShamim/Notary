/**
 * demo-two-party — a full happy-path escrow deal on LIVE testnet2.
 *
 *   buyer ──deal.open──▶ @notary ──deal.invite──▶ seller
 *   seller ──deal.accept──▶ @notary ──payment request──▶ buyer
 *   buyer pays → FUNDED → seller ──deal.delivered──▶ buyer ──deal.confirm──▶
 *   @notary autonomously pays seller (amount − 1% fee). Humans/actors only
 *   express intent; every settlement transfer is initiated by the agent.
 *
 * Prereq: the agent is running (npm run dev:agent).
 */
import { getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
import { awaitPaymentRequest, balanceOf, dmNotary, fund, isUpdateTo, makeActor, requireAgentOnline, runNonce, say, waitFor, waitForInvite } from './lib.js';

const AMOUNT = 100_000n;

async function main(): Promise<void> {
  await requireAgentOnline();

  say('demo', 'creating throwaway buyer + seller wallets on testnet2…');
  const [buyer, seller] = await Promise.all([makeActor('buyer'), makeActor('seller')]);
  await fund(buyer, AMOUNT * 2n);
  const sellerBefore = await balanceOf(seller);
  const nonce = runNonce();

  // 1. buyer opens the deal
  await dmNotary(buyer, {
    v: 1,
    type: 'deal.open',
    seller: `@${seller.tag}`,
    amount: AMOUNT.toString(),
    coinId: getCoinIdBySymbol('UCT')!,
    deliverable: `One ASCII dragon, at least 20 lines, tasteful ${nonce}`,
    deliveryHours: 1,
  });

  // 2. seller receives THIS run's invite (matched by nonce, ignoring replays) and accepts
  const invite = await waitForInvite(seller, nonce);
  const dealId = invite.dealId;
  say('demo', `deal ${dealId} proposed — fee ${invite.feeBps} bps, escrow ${invite.amount} base units`);
  await dmNotary(seller, { v: 1, type: 'deal.accept', dealId });

  // 3. buyer waits for the notary's payment request and pays it
  say('buyer', 'waiting for the escrow payment request…');
  const request = await awaitPaymentRequest(buyer, dealId);
  say('buyer', `payment request received — paying ${AMOUNT} into escrow`);
  await buyer.sphere.payments.payPaymentRequest(request.id, `notary deal ${dealId}`);

  await waitFor(buyer, 'FUNDED update', isUpdateTo(dealId, 'FUNDED'), 180_000);
  say('demo', '✔ escrow FUNDED — the notary verified the transfer landed on-chain');

  // 4. seller delivers
  await dmNotary(seller, { v: 1, type: 'deal.delivered', dealId, proof: 'ipfs://demo-dragon' });
  await waitFor(buyer, 'DELIVERED_CLAIMED update', isUpdateTo(dealId, 'DELIVERED_CLAIMED'));

  // 5. buyer confirms; the agent settles autonomously
  await dmNotary(buyer, { v: 1, type: 'deal.confirm', dealId });
  const released = await waitFor(seller, 'RELEASED update', isUpdateTo(dealId, 'RELEASED'), 240_000);
  say('demo', `✔ RELEASED — settlement: ${JSON.stringify(released.deal.settlement)}`);

  // 6. verify the money actually moved
  say('seller', 'waiting for the payout to land…');
  const expected = sellerBefore + (AMOUNT * 99n) / 100n;
  for (let i = 0; i < 60; i++) {
    await seller.sphere.payments.pumpIncomingDeliveries().catch(() => 0);
    if ((await balanceOf(seller)) >= expected) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  const sellerAfter = await balanceOf(seller);
  say('demo', `seller balance ${sellerBefore} → ${sellerAfter} (expected +${(AMOUNT * 99n) / 100n})`);
  if (sellerAfter < expected) throw new Error('payout did not land in time');

  say('demo', '🎉 two-party escrow completed end-to-end on testnet2 — the agent alone moved the money.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ demo failed:', err);
  process.exit(1);
});
