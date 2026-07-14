import { encodeMessage, type NotaryMessage } from '@notary/shared';
import { getConnectClient, sendDmIntent } from './connect.js';
import { NOTARY_TAG } from './sphere.js';

/**
 * Send a protocol message to the notary agent over an encrypted DM.
 * Goes through the connected Sphere wallet as a `dm` intent — the wallet signs
 * and sends it; this app never holds a key.
 */
export async function dmNotary(msg: NotaryMessage): Promise<string> {
  const client = getConnectClient();
  if (!client) throw new Error('Connect your Sphere wallet first.');
  const payload = encodeMessage(msg);
  await sendDmIntent(client, `@${NOTARY_TAG}`, payload);
  return payload;
}
