import { createHash } from 'node:crypto';

import { type ModelMessage, type ModelRequest } from './types.js';

/**
 * Deterministically serialise the part of a request that a provider actually
 * sees — the system prefix and the messages — so two requests with the same
 * input produce the same string regardless of object key order. Model id and
 * promptVersion are deliberately excluded: the digest is of the *input*, and the
 * cache key composes it with those separately (`sha256(model+promptVersion+…)`).
 */
function renderForDigest(request: Pick<ModelRequest, 'system' | 'messages'>): string {
  const normalizedMessages = request.messages.map((message: ModelMessage) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) =>
            block.type === 'text'
              ? { type: block.type, text: block.text }
              : { type: block.type, mediaType: block.mediaType, dataBase64: block.dataBase64 },
          ),
  }));

  return JSON.stringify({ system: request.system ?? null, messages: normalizedMessages });
}

/** The sha256 hex digest of a request's rendered input. Lowercase, 64 chars. */
export function computeInputDigest(request: Pick<ModelRequest, 'system' | 'messages'>): string {
  return createHash('sha256').update(renderForDigest(request), 'utf8').digest('hex');
}
