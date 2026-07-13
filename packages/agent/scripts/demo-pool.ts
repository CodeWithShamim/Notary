/**
 * demo-pool — NIP-29 group escrow pool on LIVE testnet2.
 *
 * Creator makes a public group, DMs "@notary !pool watch <groupId>" so the
 * agent joins, then three contributors run !pool create / join and pay the
 * agent's payment requests. The creator pays the pot out to a recipient; the
 * agent transfers pot − 1% fee.
 *
 * Prereq: the agent is running (npm run dev:agent).
 */
import { getCoinIdBySymbol, type GroupMessageData } from '@unicitylabs/sphere-sdk';
import { NOTARY_TAG, balanceOf, fund, makeActor, requireAgentOnline, say, type Actor } from './lib.js';

const EACH = 20_000n;

async function main(): Promise<void> {
  await requireAgentOnline();
  const [alice, bob, carol] = await Promise.all([
    makeActor('p-alice', { groupChat: true }),
    makeActor('p-bob', { groupChat: true }),
    makeActor('p-carol', { groupChat: true }),
  ]);
  await Promise.all([fund(alice, EACH * 2n), fund(bob, EACH * 2n), fund(carol, EACH * 2n)]);

  const gcA = alice.sphere.groupChat!;
  await gcA.connect();
  // The NIP-29 relay requires NIP-42 auth; the SDK answers the challenge, but
  // publishing a group-create event can race ahead of the handshake. Give auth
  // a moment, then retry.
  let group: Awaited<ReturnType<typeof gcA.createGroup>> = null;
  for (let attempt = 0; attempt < 6 && !group; attempt++) {
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      group = await gcA.createGroup({ name: `notary-pool-demo-${Date.now() % 100000}`, description: 'Notary pool demo' });
    } catch (err) {
      say('demo', `group create attempt ${attempt + 1} failed (${(err as Error).message.slice(0, 40)}…), retrying after auth settles`);
    }
  }
  if (!group) throw new Error('group creation failed after retries (relay auth)');
  say('demo', `group ${group.id} created — inviting @notary via DM`);
  await alice.sphere.communications.sendDM(`@${NOTARY_TAG}`, `!pool watch ${group.id}`);

  // The agent DMs back "Watching group <id>…" once it has joined — that DM is a
  // reliable join-confirmation (group-message propagation to the creator can lag).
  const watchStart = Date.now();
  const confirmed = () => alice.rawInbox.some((m) => m.content.includes(`Watching group ${group!.id}`));
  while (!confirmed() && Date.now() - watchStart < 120_000) {
    await alice.sphere.communications.sendDM(`@${NOTARY_TAG}`, `!pool watch ${group.id}`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!confirmed()) throw new Error('agent never confirmed watching the group');
  say('demo', '✔ @notary confirmed it is watching the group');

  for (const actor of [bob, carol]) {
    await actor.sphere.groupChat!.connect();
    await actor.sphere.groupChat!.joinGroup(group.id);
  }
  // Let all members' subscriptions settle before chatting.
  await new Promise((r) => setTimeout(r, 5_000));

  // watch group chatter + auto-pay contribution requests
  const transcripts: string[] = [];
  const watch = (actor: Actor) =>
    actor.sphere.groupChat!.onMessage((m: GroupMessageData) => {
      const line = `[group] ${m.senderNametag ?? m.senderPubkey.slice(0, 8)}: ${m.content}`;
      if (!transcripts.includes(line)) {
        transcripts.push(line);
        console.log(line);
      }
    });
  watch(alice);
  watch(bob);
  watch(carol);
  // Contributors auto-pay the agent's pool payment requests. Metadata is dropped
  // on the wire (NOTES §4), so identify pool requests by the message text.
  for (const actor of [alice, bob, carol]) {
    const pay = (r: { id: string; message?: string; metadata?: unknown }) => {
      const meta = r.metadata as { poolId?: string } | undefined;
      if (meta?.poolId || r.message?.includes('Pool pool_')) {
        say(actor.name, `paying pool contribution`);
        void actor.sphere.payments.payPaymentRequest(r.id, `pool contribution`);
      }
    };
    actor.sphere.payments.onPaymentRequest(pay);
    // Fallback: poll, since the live handler isn't reliable (NOTES §4).
    setInterval(() => {
      void actor.sphere.payments.syncPaymentRequests().then(() => {
        for (const r of actor.sphere.payments.getPaymentRequests({ status: 'pending' })) pay(r);
      }).catch(() => undefined);
    }, 4_000);
  }

  const sendAndWait = async (actor: Actor, text: string, expect: RegExp, timeoutMs = 120_000): Promise<string> => {
    await actor.sphere.groupChat!.sendMessage(group.id, text);
    say(actor.name, `→ group: ${text}`);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hit = transcripts.find((t) => expect.test(t));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`timed out waiting for ${expect}`);
  };

  const coin = getCoinIdBySymbol('UCT')!;
  const created = await sendAndWait(alice, `!pool create ${EACH} ${coin} Team pizza fund`, /Pool (pool_\w+) created/);
  const poolId = created.match(/Pool (pool_\w+) created/)![1]!;
  say('demo', `pool ${poolId} open`);

  await sendAndWait(alice, `!pool join ${poolId}`, new RegExp(`@${alice.tag} joined ${poolId}`));
  await sendAndWait(bob, `!pool join ${poolId}`, new RegExp(`@${bob.tag} joined ${poolId}`));
  await sendAndWait(carol, `!pool join ${poolId}`, new RegExp(`@${carol.tag} joined ${poolId}`));

  // wait for all three contributions to be acknowledged in-group
  const paidStart = Date.now();
  while (transcripts.filter((t) => t.includes(`${poolId}: @`) && t.includes('paid in')).length < 3) {
    if (Date.now() - paidStart > 5 * 60_000) throw new Error('contributions not all acknowledged');
    await new Promise((r) => setTimeout(r, 2_000));
  }
  say('demo', 'all three contributions verified by the agent');

  const carolBefore = await balanceOf(carol);
  await sendAndWait(alice, `!pool payout ${poolId} @${carol.tag}`, new RegExp(`${poolId} paying out`));

  const pot = EACH * 3n;
  const expected = carolBefore + pot - pot / 100n;
  say('carol', 'waiting for the pot to land…');
  for (let i = 0; i < 60; i++) {
    await carol.sphere.payments.pumpIncomingDeliveries().catch(() => 0);
    if ((await balanceOf(carol)) >= expected) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  const carolAfter = await balanceOf(carol);
  say('demo', `carol balance ${carolBefore} → ${carolAfter} (expected +${pot - pot / 100n})`);
  if (carolAfter < expected) throw new Error('pool payout did not land');
  say('demo', '🎉 group pool: create → 3 × join/fund → payout, all agent-verified on testnet2.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ demo failed:', err);
  process.exit(1);
});
