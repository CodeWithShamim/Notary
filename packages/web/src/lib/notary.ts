import { encodeMessage, type NotaryMessage } from '@notary/shared';
import { getSphere, NOTARY_TAG } from './sphere.js';

/** Send a protocol message to the notary agent over an encrypted NIP-17 DM. */
export async function dmNotary(msg: NotaryMessage): Promise<string> {
  const sphere = getSphere();
  if (!sphere) throw new Error('wallet not ready');
  const payload = encodeMessage(msg);
  await sphere.communications.sendDM(`@${NOTARY_TAG}`, payload);
  return payload;
}
