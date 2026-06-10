import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { LogRecord } from './types.js';

export interface ParseStats {
  lines: number;
  parsed: number;
  skipped: number;
}

/**
 * Stream a session JSONL file line by line without loading it into memory.
 * Malformed lines are counted and skipped — the log format is undocumented
 * and changes between Claude Code versions, so we never throw on bad input.
 */
export async function* parseSessionFile(
  path: string,
  stats?: ParseStats,
): AsyncGenerator<LogRecord> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (stats) stats.lines++;
    if (line.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      if (stats) stats.skipped++;
      continue;
    }
    if (typeof record === 'object' && record !== null && 'type' in record) {
      if (stats) stats.parsed++;
      yield record as LogRecord;
    } else {
      if (stats) stats.skipped++;
    }
  }
}
