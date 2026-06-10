import { opendir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { SessionFile } from './types.js';

/** Root of Claude Code's local data. Honors CLAUDE_CONFIG_DIR like Claude Code itself. */
export function claudeProjectsDir(): string {
  const configDir = process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  return join(configDir, 'projects');
}

/** Recursively find every session .jsonl under the projects dir. */
export async function discoverSessionFiles(root = claudeProjectsDir()): Promise<SessionFile[]> {
  const found: SessionFile[] = [];
  await walk(root, found, root);
  return found;
}

async function walk(dir: string, found: SessionFile[], root: string): Promise<void> {
  let entries;
  try {
    entries = await opendir(dir);
  } catch {
    return; // unreadable or missing dir — not an error for us
  }
  for await (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, found, root);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const rel = relative(root, full);
      const parts = rel.split(sep);
      found.push({
        path: full,
        project: parts[0] ?? '',
        isSubagent: parts.includes('subagents'),
        sizeBytes: statSync(full).size,
      });
    }
  }
}
