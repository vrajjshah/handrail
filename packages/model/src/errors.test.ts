import { ModelErrorCodeSchema } from '@handrail/schemas';
import { describe, expect, it } from 'vitest';

import { isModelError, ModelError, RETRYABLE_ERROR_CODES, toModelError } from './errors.js';

describe('ModelError', () => {
  it('classifies every error code as retryable or not, per the shared set', () => {
    for (const code of ModelErrorCodeSchema.options) {
      expect(new ModelError(code).retryable).toBe(RETRYABLE_ERROR_CODES.has(code));
    }
  });

  it('marks the transient failures retryable and the rest not', () => {
    expect(new ModelError('rate-limit').retryable).toBe(true);
    expect(new ModelError('overloaded').retryable).toBe(true);
    expect(new ModelError('timeout').retryable).toBe(true);
    expect(new ModelError('network').retryable).toBe(true);

    expect(new ModelError('auth').retryable).toBe(false);
    expect(new ModelError('context-length').retryable).toBe(false);
    expect(new ModelError('schema-invalid').retryable).toBe(false);
    expect(new ModelError('budget-exceeded').retryable).toBe(false);
  });

  it('lets a provider override the default retryability', () => {
    expect(new ModelError('auth', 'no', { retryable: true }).retryable).toBe(true);
    expect(new ModelError('rate-limit', 'no', { retryable: false }).retryable).toBe(false);
  });

  it('defaults its message to the code and carries the provider', () => {
    const error = new ModelError('overloaded', undefined, { provider: 'anthropic' });
    expect(error.message).toBe('overloaded');
    expect(error.provider).toBe('anthropic');
    expect(error.name).toBe('ModelError');
  });
});

describe('toModelError', () => {
  it('passes an existing ModelError through untouched', () => {
    const original = new ModelError('timeout');
    expect(toModelError(original)).toBe(original);
  });

  it('wraps a plain Error as a provider-error, preserving the message and cause', () => {
    const cause = new Error('socket hang up');
    const wrapped = toModelError(cause, 'bedrock');
    expect(wrapped.code).toBe('provider-error');
    expect(wrapped.message).toBe('socket hang up');
    expect(wrapped.provider).toBe('bedrock');
    expect(wrapped.cause).toBe(cause);
  });

  it('wraps a non-Error throw as a provider-error', () => {
    const wrapped = toModelError('something weird');
    expect(wrapped.code).toBe('provider-error');
    expect(wrapped.message).toBe('something weird');
  });

  it('recognises its own instances', () => {
    expect(isModelError(new ModelError('auth'))).toBe(true);
    expect(isModelError(new Error('nope'))).toBe(false);
  });
});
