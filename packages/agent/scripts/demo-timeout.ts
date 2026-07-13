/**
 * demo-timeout — the refund path on LIVE testnet2.
 *
 * Buyer funds the escrow; the seller never delivers. The deal uses a 3-minute
 * delivery window (deliveryHours: 0.05), so within ~4 minutes the agent
 * AUTONOMOUSLY refunds the buyer in full — no human presses anything.
 *
 * Prereq: the agent is running (npm run dev:agent).
 */
import { getCoinIdBySymbol } from '@unicitylabs/sphere-sdk';
import { awaitPaymentRequest, balanceOf, dmNotary, fund, isUpdateTo, makeActor, requireAgentOnline, runNonce, say, waitFor, waitForInvite } from './lib.js';

const AMOUNT = 50_000n;

async function main(): Promise<void> {
  await requireAgentOnline();
  const [buyer, seller] = await Promise.all([makeActor('t-buyer'), makeActor('t-seller')]);
  await fund(buyer, AMOUNT * 2n);
  const nonce = runNonce();

  await dmNotary(buyer, {
    v: 1,
    type: 'deal.open',
    seller: `@${seller.tag}`,
    amount: AMOUNT.toString(),
    coinId: getCoinIdBySymbol('UCT')!,
    deliverable: `Anything, really — the seller is going to ghost ${nonce}`,
    deliveryHours: 0.05, // 3 minutes
  });

  const invite = await waitForInvite(seller, nonce);
  const dealId = invite.dealId;
  await dmNotary(seller, { v: 1, type: 'deal.accept', dealId });

  const request = await awaitPaymentRequest(buyer, dealId);
  await buyer.sphere.payments.payPaymentRequest(request.id, `notary deal ${dealId}`);
  await waitFor(buyer, 'FUNDED update', isUpdateTo(dealId, 'FUNDED'), 180_000);
  const buyerFunded = await balanceOf(buyer);
  say('demo', `escrow FUNDED. Seller now ghosts. Delivery window is 3 minutes — watch the agent refund on its own…`);

  const refunded = await waitFor(buyer, 'REFUNDED update', isUpdateTo(dealId, 'REFUNDED'), 8 * 60_000);
  say('demo', `✔ REFUNDED autonomously: ${JSON.stringify(refunded.deal.settlement)}`);

  say('buyer', 'waiting for the refund to land…');
  const expected = buyerFunded + AMOUNT;
  for (let i = 0; i < 60; i++) {
    await buyer.sphere.payments.pumpIncomingDeliveries().catch(() => 0);
    if ((await balanceOf(buyer)) >= expected) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  const after = await balanceOf(buyer);
  say('demo', `buyer balance ${buyerFunded} → ${after} (expected +${AMOUNT} full refund)`);
  if (after < expected) throw new Error('refund did not land in time');
  say('demo', '🎉 timeout-refund path verified end-to-end on testnet2.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ demo failed:', err);
  process.exit(1);
});
