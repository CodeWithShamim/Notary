import { describe, expect, it } from 'vitest';
import {
  DealEvent,
  DealState,
  DEAL_STATES,
  HELP_TEXT,
  LEGAL_TRANSITIONS,
  TERMINAL_STATES,
  amountToBigint,
  computeFee,
  disputeSplit,
  encodeMessage,
  nextState,
  parseMessage,
  releaseSplit,
  type NotaryMessage,
} from './protocol.js';

describe('fee math', () => {
  it('computes 1% (100 bps) with flooring', () => {
    expect(computeFee(10_000n, 100)).toBe(100n);
    expect(computeFee(99n, 100)).toBe(0n); // floors, never rounds up
    expect(computeFee(101n, 100)).toBe(1n);
    expect(computeFee(0n, 100)).toBe(0n);
  });

  it('handles amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 10n ** 30n;
    expect(computeFee(huge, 100)).toBe(huge / 100n);
  });

  it('rejects bad inputs', () => {
    expect(() => computeFee(-1n, 100)).toThrow(RangeError);
    expect(() => computeFee(1n, -1)).toThrow(RangeError);
    expect(() => computeFee(1n, 10_001)).toThrow(RangeError);
    expect(() => computeFee(1n, 1.5)).toThrow(RangeError);
  });

  it('release split conserves the total', () => {
    const { toSeller, fee } = releaseSplit(123_456_789n, 100);
    expect(toSeller + fee).toBe(123_456_789n);
    expect(fee).toBe(1_234_567n);
  });

  it('dispute split conserves the total', () => {
    const { toBuyer, fee } = disputeSplit(1_000_000n, 50);
    expect(toBuyer + fee).toBe(1_000_000n);
    expect(fee).toBe(5_000n);
  });

  it('amountToBigint accepts only integer strings', () => {
    expect(amountToBigint('42')).toBe(42n);
    expect(() => amountToBigint('4.2')).toThrow();
    expect(() => amountToBigint('-1')).toThrow();
    expect(() => amountToBigint('1e5')).toThrow();
    expect(() => amountToBigint('')).toThrow();
  });
});

describe('state machine table', () => {
  it('covers the full spec table', () => {
    expect(nextState(DealState.PROPOSED, DealEvent.ACCEPT)).toBe(DealState.AWAITING_FUNDS);
    expect(nextState(DealState.PROPOSED, DealEvent.REJECT)).toBe(DealState.CANCELLED);
    expect(nextState(DealState.PROPOSED, DealEvent.ACCEPT_TIMEOUT)).toBe(DealState.CANCELLED);
    expect(nextState(DealState.AWAITING_FUNDS, DealEvent.FUNDS_RECEIVED)).toBe(DealState.FUNDED);
    expect(nextState(DealState.AWAITING_FUNDS, DealEvent.FUNDING_TIMEOUT)).toBe(DealState.EXPIRED);
    expect(nextState(DealState.FUNDED, DealEvent.DELIVERED)).toBe(DealState.DELIVERED_CLAIMED);
    expect(nextState(DealState.FUNDED, DealEvent.DELIVERY_TIMEOUT)).toBe(DealState.REFUNDED);
    expect(nextState(DealState.DELIVERED_CLAIMED, DealEvent.CONFIRM)).toBe(DealState.RELEASED);
    expect(nextState(DealState.DELIVERED_CLAIMED, DealEvent.DISPUTE)).toBe(DealState.REFUNDED);
    expect(nextState(DealState.DELIVERED_CLAIMED, DealEvent.CONFIRM_TIMEOUT)).toBe(
      DealState.RELEASED,
    );
  });

  it('rejects every transition not in the table', () => {
    let legal = 0;
    let illegal = 0;
    for (const from of DEAL_STATES) {
      for (const event of Object.values(DealEvent)) {
        const to = nextState(from, event);
        if (to === null) illegal++;
        else legal++;
      }
    }
    expect(legal).toBe(10);
    expect(illegal).toBe(DEAL_STATES.length * Object.values(DealEvent).length - 10);
  });

  it('terminal states have no outgoing transitions', () => {
    for (const s of TERMINAL_STATES) {
      expect(LEGAL_TRANSITIONS[s]).toBeUndefined();
    }
  });
});

describe('wire protocol parsing', () => {
  const open: NotaryMessage = {
    v: 1,
    type: 'deal.open',
    seller: '@bob',
    amount: '5000000000',
    coinId: 'abc123',
    deliverable: 'Logo design, 3 concepts',
    deliveryHours: 72,
  };

  it('round-trips a valid deal.open', () => {
    const res = parseMessage(encodeMessage(open));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.msg).toEqual(open);
  });

  it('rejects non-integer amounts as malformed', () => {
    const res = parseMessage(JSON.stringify({ ...open, amount: '5.5' }));
    expect(res).toMatchObject({ ok: false, malformed: true });
    if (!res.ok) expect(res.issues).toContain('amount');
  });

  it('rejects unknown protocol version as malformed', () => {
    const res = parseMessage(JSON.stringify({ ...open, v: 2 }));
    expect(res).toMatchObject({ ok: false, malformed: true });
  });

  it('treats plain chat as non-protocol, not malformed', () => {
    expect(parseMessage('hey what do you do?')).toEqual({ ok: false, malformed: false });
    expect(parseMessage('"just a string"')).toEqual({ ok: false, malformed: false });
  });

  it('parses a deal.update snapshot', () => {
    const update = {
      v: 1,
      type: 'deal.update',
      deal: {
        dealId: 'deal_0001',
        state: 'FUNDED',
        buyer: 'aa'.repeat(32),
        seller: 'bb'.repeat(32),
        amount: '1000000000',
        coinId: 'abc',
        feeBps: 100,
        deliverable: 'thing',
        deliveryHours: 72,
        createdAt: 1750000000000,
        deadlineAt: 1750000360000,
      },
    };
    const res = parseMessage(JSON.stringify(update));
    expect(res.ok).toBe(true);
  });

  it('rejects a snapshot with an unknown state', () => {
    const res = parseMessage(
      JSON.stringify({
        v: 1,
        type: 'deal.update',
        deal: { dealId: 'deal_0001', state: 'LIMBO' },
      }),
    );
    expect(res).toMatchObject({ ok: false, malformed: true });
  });

  it('parses structured errors', () => {
    const res = parseMessage(
      JSON.stringify({ v: 1, type: 'error', code: 'UNKNOWN_DEAL', message: 'nope', dealId: 'deal_x' }),
    );
    expect(res.ok).toBe(true);
  });

  it('help text mentions every command', () => {
    for (const cmd of [
      'deal.open',
      'deal.accept',
      'deal.reject',
      'deal.delivered',
      'deal.confirm',
      'deal.dispute',
      'deal.status',
    ]) {
      expect(HELP_TEXT).toContain(cmd);
    }
  });
});
