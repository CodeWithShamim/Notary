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
