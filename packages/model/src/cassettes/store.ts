import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';

import { type AnthropicMessageResponse } from '../providers/anthropic-messages.js';
import {
  type Cassette,
  CassetteFileSchema,
  type CassetteKey,
  type CassetteStore,
} from './types.js';

/** The committed corpus. Cassettes live in the repo — they are the CI fixture. */
export const DEFAULT_CASSETTE_DIR = 'cassettes';

/** Path segments come from an enum and our own version strings, but never trust them raw. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Cassettes on disk, one JSON file per interaction at
 * `<root>/<role>/<promptVersion>/<inputDigest>.json`. One file per interaction
 * (rather than one big index) keeps diffs readable: re-recording a single prompt
 * touches a single file, so a reviewer can see exactly what the model's behaviour
 * change was.
 */
export class FileCassetteStore implements CassetteStore {
  readonly root: string;

  constructor(root: string = DEFAULT_CASSETTE_DIR) {
    this.root = root;
  }

  pathFor(key: CassetteKey): string {
    return path.join(
      this.root,
      safeSegment(key.role),
      safeSegment(key.promptVersion),
      `${safeSegment(key.inputDigest)}.json`,
    );
  }

  async read(key: CassetteKey): Promise<Cassette | undefined> {
    const file = this.pathFor(key);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    return parseCassette(raw, file);
  }

  async write(cassette: Cassette): Promise<void> {
    const file = this.pathFor(cassette.key);
    await mkdir(path.dirname(file), { recursive: true });
    // Pretty-printed with a trailing newline so the committed corpus diffs cleanly.
    await writeFile(file, `${JSON.stringify(cassette, null, 2)}\n`, 'utf8');
  }

  async list(): Promise<Cassette[]> {
    const files = await this.jsonFilesUnder(this.root);
    files.sort();
    const cassettes: Cassette[] = [];
    for (const file of files) {
      cassettes.push(parseCassette(await readFile(file, 'utf8'), file));
    }
    return cassettes;
  }

  private async jsonFilesUnder(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const found: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...(await this.jsonFilesUnder(full)));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        found.push(full);
      }
    }
    return found;
  }
}

export function parseCassette(raw: string, file: string): Cassette {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`cassette at ${file} is not valid JSON`);
  }

  const parsed = CassetteFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`cassette at ${file} is malformed: ${parsed.error.message}`);
  }

  const { version, key, recordedAt, request, response } = parsed.data;
  return {
    version,
    key,
    recordedAt,
    // The wire payloads are validated structurally above and passed through as
    // the SDK shapes they were recorded from.
    request: request as unknown as MessageCreateParamsNonStreaming,
    response: response as unknown as AnthropicMessageResponse,
  };
}
