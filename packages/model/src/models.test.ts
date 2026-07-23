import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_MODELS, HAIKU_4_5, resolveModel, SONNET_5 } from './models.js';

describe('the default role → model map', () => {
  it('routes the cheap high-volume roles to Haiku 4.5', () => {
    expect(DEFAULT_ROLE_MODELS.triage).toBe(HAIKU_4_5);
    expect(DEFAULT_ROLE_MODELS['text-judge']).toBe(HAIKU_4_5);
    expect(DEFAULT_ROLE_MODELS.verifier).toBe(HAIKU_4_5);
  });

  it('routes vision and fixes to Sonnet 5', () => {
    expect(DEFAULT_ROLE_MODELS['vision-judge']).toBe(SONNET_5);
    expect(DEFAULT_ROLE_MODELS.fix).toBe(SONNET_5);
  });
});

describe('resolveModel', () => {
  it('uses the role default when no model is given', () => {
    expect(resolveModel({ role: 'text-judge' })).toBe(HAIKU_4_5);
    expect(resolveModel({ role: 'vision-judge' })).toBe(SONNET_5);
  });

  it('lets an explicit model override the role default', () => {
    expect(resolveModel({ role: 'text-judge', model: 'claude-something-else' })).toBe(
      'claude-something-else',
    );
  });
});
