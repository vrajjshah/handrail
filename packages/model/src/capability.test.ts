import { describe, expect, it } from 'vitest';

import { capabilityFor, UnknownModelCapabilityError } from './capability.js';
import { HAIKU_4_5, SONNET_5 } from './models.js';

describe('capabilityFor — the ADR-0004 constraints, encoded as data', () => {
  it('records that Sonnet 5 rejects sampling params and runs adaptive thinking', () => {
    const caps = capabilityFor('anthropic', SONNET_5);
    expect(caps.allowsSamplingParams).toBe(false);
    expect(caps.defaultThinking).toBe('adaptive');
  });

  it('records the model-specific cacheable-prefix floors', () => {
    expect(capabilityFor('anthropic', HAIKU_4_5).minCacheablePrefixTokens).toBe(4096);
    expect(capabilityFor('anthropic', SONNET_5).minCacheablePrefixTokens).toBe(2048);
  });

  it('records the high-res vision ceiling that makes Sonnet 5 the vision model', () => {
    expect(capabilityFor('anthropic', SONNET_5).visionMaxImageDimensionPx).toBe(2576);
  });

  it('lets Haiku 4.5 set sampling params and defaults its thinking off', () => {
    const caps = capabilityFor('anthropic', HAIKU_4_5);
    expect(caps.allowsSamplingParams).toBe(true);
    expect(caps.defaultThinking).toBe('disabled');
  });

  it('encodes the forced-tool-choice difference as a Bedrock override, not a runtime probe', () => {
    expect(capabilityFor('anthropic', SONNET_5).forcedToolChoiceRequiresThinkingDisabled).toBe(
      false,
    );
    expect(capabilityFor('bedrock', SONNET_5).forcedToolChoiceRequiresThinkingDisabled).toBe(true);
  });

  it('gives the deterministic backend permissive, constraint-free capabilities', () => {
    const caps = capabilityFor('local-deterministic', 'anything-at-all');
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.minCacheablePrefixTokens).toBe(0);
  });

  it('throws rather than guessing for an unmapped billable model', () => {
    expect(() => capabilityFor('anthropic', 'gpt-imaginary')).toThrow(UnknownModelCapabilityError);
  });
});
