import { describe, expect, it } from 'vitest';

import { computeInputDigest } from './digest.js';

describe('computeInputDigest', () => {
  it('is a lowercase 64-char sha256 hex string', () => {
    const digest = computeInputDigest({ messages: [{ role: 'user', content: 'hi' }] });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same input', () => {
    const input = { system: 'you are a judge', messages: [{ role: 'user' as const, content: 'hi' }] };
    expect(computeInputDigest(input)).toBe(computeInputDigest(input));
  });

  it('does not depend on the order of keys the caller happened to use', () => {
    const a = computeInputDigest({
      system: 's',
      messages: [{ content: 'hi', role: 'user' }],
    });
    const b = computeInputDigest({
      messages: [{ role: 'user', content: 'hi' }],
      system: 's',
    });
    expect(a).toBe(b);
  });

  it('changes when the message content changes', () => {
    const a = computeInputDigest({ messages: [{ role: 'user', content: 'hi' }] });
    const b = computeInputDigest({ messages: [{ role: 'user', content: 'ho' }] });
    expect(a).not.toBe(b);
  });

  it('changes when the system prefix changes', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const a = computeInputDigest({ system: 'one', messages });
    const b = computeInputDigest({ system: 'two', messages });
    expect(a).not.toBe(b);
  });

  it('distinguishes an absent system prefix from an empty one', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }];
    expect(computeInputDigest({ messages })).not.toBe(computeInputDigest({ system: '', messages }));
  });
});
