import { encodeMessage, type NotaryMessage } from '@notary/shared';
import { getConnectClient, sendDmIntent } from './connect.js';
import { NOTARY_TAG } from './sphere.js';

/** Plain-language heading for the wallet signature overlay, per message type the
 *  buyer/seller sends. Other (notary→user) types fall back to a generic prompt. */
const SIGN_LABEL: Partial<Record<NotaryMessage['type'], string>> = {
  'deal.open': 'Propose deal',
  'deal.accept': 'Accept deal',
  'deal.reject': 'Reject deal',
  'deal.delivered': 'Mark as delivered',
  'deal.confirm': 'Confirm delivery',
  'deal.dispute': 'File dispute',
  'offer.post': 'Post offer',
  'offer.close': 'Close offer',
};

/**
 * Send a protocol message to the notary agent over an encrypted DM.
 * Goes through the connected Sphere wallet as a `dm` intent - the wallet signs
 * and sends it; this app never holds a key.
 */
export async function dmNotary(msg: NotaryMessage): Promise<string> {
  const client = getConnectClient();
  if (!client) throw new Error('Connect your Sphere wallet first.');
  const payload = encodeMessage(msg);
  await sendDmIntent(client, `@${NOTARY_TAG}`, payload, SIGN_LABEL[msg.type]);
  return payload;
}

/**
 * Invite @notary to watch a NIP-29 group for `!pool` commands. Unlike the deal
 * protocol, this is a plain-text control DM (`!pool watch <groupId>`) that the
 * agent's DM handler joins the group on — group-chat itself is out of the
 * wallet's scope, so the browser can't post `!pool create/join` directly. After
 * the agent joins, contributors run those commands inside the group chat.
 */
export async function watchPoolGroup(groupId: string): Promise<void> {
  const client = getConnectClient();
  if (!client) throw new Error('Connect your Sphere wallet first.');
  await sendDmIntent(client, `@${NOTARY_TAG}`, `!pool watch ${groupId.trim()}`, 'Invite notary to group');
}
