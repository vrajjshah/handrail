import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import { HAIKU_4_5 } from '../models.js';
import {
  type AnthropicMessageResponse,
  type MessagesTransport,
  type TransportContext,
} from '../providers/anthropic-messages.js';
import { describeStaleCassettes, findStaleCassettes, findUncoveredRoles } from './freshness.js';
import { refreshCassettes } from './refresh.js';
import { FileCassetteStore } from './store.js';
import { CassetteMissError, resolveModelMode, withCassettes } from './transport.js';
import { type Cassette } from './types.js';

const DIGEST = 'a'.repeat(64);

async function tempStore(): Promise<FileCassetteStore> {
  return new FileCassetteStore(await mkdtemp(path.join(os.tmpdir(), 'handrail-cassettes-')));
}

const REQUEST: MessageCreateParamsNonStreaming = {
  model: HAIKU_4_5,
  max_tokens: 100,
  messages: [{ role: 'user', content: 'hi' }],
};

function response(text = 'ok'): AnthropicMessageResponse {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 2 },
  };
}

function makeCassette(overrides: Partial<Cassette> = {}): Cassette {
  return {
    version: 1,
    key: {
      role: 'text-judge',
      promptVersion: 'v1',
      inputDigest: DIGEST,
      provider: 'anthropic',
      model: HAIKU_4_5,
    },
    recordedAt: '2026-07-23T10:00:00.000Z',
    request: REQUEST,
    response: response(),
    ...overrides,
  };
}

const CONTEXT: TransportContext = {
  provider: 'anthropic',
  role: 'text-judge',
  promptVersion: 'v1',
  model: HAIKU_4_5,
  inputDigest: DIGEST,
};

describe('resolveModelMode', () => {
  it('defaults to live when unset or empty', () => {
    expect(resolveModelMode({})).toBe('live');
    expect(resolveModelMode({ MODEL_MODE: '' })).toBe('live');
    expect(resolveModelMode({ MODEL_MODE: 'live' })).toBe('live');
  });

  it('accepts record and replay, case-insensitively', () => {
    expect(resolveModelMode({ MODEL_MODE: 'record' })).toBe('record');
    expect(resolveModelMode({ MODEL_MODE: 'REPLAY' })).toBe('replay');
  });

  it('throws on an unknown mode rather than silently going live', () => {
    expect(() => resolveModelMode({ MODEL_MODE: 'offline' })).toThrow(/unknown MODEL_MODE/);
  });
});

describe('FileCassetteStore', () => {
  it('round-trips a cassette', async () => {
    const store = await tempStore();
    const cassette = makeCassette();
    await store.write(cassette);
    expect(await store.read(cassette.key)).toEqual(cassette);
  });

  it('returns undefined for a key it has never seen', async () => {
    const store = await tempStore();
    expect(await store.read({ role: 'verifier', promptVersion: 'v9', inputDigest: DIGEST })).toBeUndefined();
  });

  it('lists every committed cassette and tolerates a missing root', async () => {
    const store = await tempStore();
    expect(await store.list()).toEqual([]);

    await store.write(makeCassette());
    await store.write(
      makeCassette({
        key: {
          role: 'verifier',
          promptVersion: 'v2',
          inputDigest: 'b'.repeat(64),
          provider: 'bedrock',
          model: HAIKU_4_5,
        },
      }),
    );
    expect(await store.list()).toHaveLength(2);
  });

  it('writes one readable file per interaction, pretty-printed', async () => {
    const store = await tempStore();
    const cassette = makeCassette();
    await store.write(cassette);

    const raw = await readFile(store.pathFor(cassette.key), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "version": 1');
  });

  it('fails loudly on a malformed cassette instead of replaying nonsense', async () => {
    const store = await tempStore();
    const file = store.pathFor(makeCassette().key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ not json', 'utf8');

    await expect(store.read(makeCassette().key)).rejects.toThrow(/not valid JSON/);
  });

  it('rejects a structurally invalid cassette', async () => {
    const store = await tempStore();
    const file = store.pathFor(makeCassette().key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1 }), 'utf8');

    await expect(store.read(makeCassette().key)).rejects.toThrow(/malformed/);
  });
});

describe('withCassettes', () => {
  function countingInner(): { transport: MessagesTransport; calls: number[] } {
    const calls: number[] = [];
    const transport: MessagesTransport = () => {
      calls.push(1);
      return Promise.resolve(response('from provider'));
    };
    return { transport, calls };
  }

  it('passes straight through in live mode and records nothing', async () => {
    const store = await tempStore();
    const inner = countingInner();
    const transport = withCassettes(inner.transport, { mode: 'live', store });

    const result = await transport(REQUEST, CONTEXT);

    expect(result.content[0]?.text).toBe('from provider');
    expect(inner.calls).toHaveLength(1);
    expect(await store.list()).toEqual([]);
  });

  it('records the request and response in record mode', async () => {
    const store = await tempStore();
    const inner = countingInner();
    const transport = withCassettes(inner.transport, {
      mode: 'record',
      store,
      now: () => new Date('2026-07-23T12:00:00.000Z'),
    });

    await transport(REQUEST, CONTEXT);

    const saved = await store.read(CONTEXT);
    expect(saved?.key).toEqual({
      role: 'text-judge',
      promptVersion: 'v1',
      inputDigest: DIGEST,
      provider: 'anthropic',
      model: HAIKU_4_5,
    });
    expect(saved?.request).toEqual(REQUEST);
    expect(saved?.response.content[0]?.text).toBe('from provider');
    expect(saved?.recordedAt).toBe('2026-07-23T12:00:00.000Z');
  });

  it('serves the recorded response in replay mode without touching the provider', async () => {
    const store = await tempStore();
    await store.write(makeCassette({ response: response('from cassette') }));
    const inner = countingInner();
    const transport = withCassettes(inner.transport, { mode: 'replay', store });

    const result = await transport(REQUEST, CONTEXT);

    expect(result.content[0]?.text).toBe('from cassette');
    expect(inner.calls).toHaveLength(0);
  });

  it('fails loudly on a replay miss rather than falling through to the network', async () => {
    const store = await tempStore();
    const inner = countingInner();
    const transport = withCassettes(inner.transport, { mode: 'replay', store });

    await expect(transport(REQUEST, CONTEXT)).rejects.toBeInstanceOf(CassetteMissError);
    expect(inner.calls).toHaveLength(0);
  });
});

describe('cassette freshness', () => {
  it('flags a cassette whose prompt has been revised', () => {
    const stale = findStaleCassettes([makeCassette()], new Map([['text-judge', 'v2']]));
    expect(stale).toHaveLength(1);
    expect(stale[0]?.reason).toBe('prompt-version-drift');
    expect(stale[0]?.expectedPromptVersion).toBe('v2');
  });

  it('flags a cassette for a role no current prompt claims', () => {
    const stale = findStaleCassettes([makeCassette()], new Map([['verifier', 'v1']]));
    expect(stale[0]?.reason).toBe('unretained-role');
  });

  it('says nothing when the corpus matches the current prompts', () => {
    expect(findStaleCassettes([makeCassette()], new Map([['text-judge', 'v1']]))).toEqual([]);
  });

  it('reports current prompts that replay does not cover at all', () => {
    const uncovered = findUncoveredRoles(
      [makeCassette()],
      new Map([
        ['text-judge', 'v1'],
        ['verifier', 'v1'],
      ]),
    );
    expect(uncovered).toEqual(['verifier']);
  });

  it('describes drift in a form a human can act on', () => {
    const stale = findStaleCassettes([makeCassette()], new Map([['text-judge', 'v2']]));
    expect(describeStaleCassettes(stale)).toContain('text-judge');
    expect(describeStaleCassettes(stale)).toContain('v2');
  });
});

describe('refreshCassettes', () => {
  it('re-issues each stored request and overwrites the response', async () => {
    const store = await tempStore();
    await store.write(makeCassette());

    const result = await refreshCassettes({
      store,
      reissue: () => Promise.resolve(response('fresh')),
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(result.refreshed).toBe(1);
    const updated = await store.read(makeCassette().key);
    expect(updated?.response.content[0]?.text).toBe('fresh');
    expect(updated?.recordedAt).toBe('2026-08-01T00:00:00.000Z');
    // The stored request is untouched — that is what makes the refresh faithful.
    expect(updated?.request).toEqual(REQUEST);
  });

  it('stops before exceeding the budget cap', async () => {
    const store = await tempStore();
    for (let index = 0; index < 3; index += 1) {
      await store.write(
        makeCassette({
          key: {
            role: 'text-judge',
            promptVersion: `v${String(index)}`,
            inputDigest: DIGEST,
            provider: 'anthropic',
            model: HAIKU_4_5,
          },
        }),
      );
    }

    // Each re-issue bills 1M input tokens on Haiku = $1, so a $1 cap allows one call.
    const expensive = (): Promise<AnthropicMessageResponse> =>
      Promise.resolve({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'x' }],
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      });

    const result = await refreshCassettes({ store, reissue: expensive, maxUsd: 1 });

    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.stoppedForBudget).toBe(true);
    expect(result.spentUsd).toBeCloseTo(1, 10);
  });
});
