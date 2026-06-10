import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ConfiguredMcpServer {
  name: string;
  /** "global" or the project paths it is configured for */
  scopes: string[];
}

/**
 * Read configured MCP servers from ~/.claude.json (global `mcpServers`
 * plus per-project `projects[path].mcpServers`). Missing or unreadable
 * config is not an error — we just can't do the configured-vs-used audit.
 */
export async function readConfiguredMcpServers(): Promise<ConfiguredMcpServer[]> {
  const base = process.env['CLAUDE_CONFIG_DIR'] ?? homedir();
  let raw: string;
  try {
    raw = await readFile(join(base, '.claude.json'), 'utf8');
  } catch {
    return [];
  }
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof config !== 'object' || config === null) return [];

  const scopes = new Map<string, string[]>();
  const add = (name: string, scope: string): void => {
    const list = scopes.get(name) ?? [];
    list.push(scope);
    scopes.set(name, list);
  };

  const cfg = config as Record<string, unknown>;
  const globalServers = cfg['mcpServers'];
  if (typeof globalServers === 'object' && globalServers !== null) {
    for (const name of Object.keys(globalServers)) add(name, 'global');
  }
  const projects = cfg['projects'];
  if (typeof projects === 'object' && projects !== null) {
    for (const [projectPath, projectCfg] of Object.entries(projects)) {
      if (typeof projectCfg !== 'object' || projectCfg === null) continue;
      const servers = (projectCfg as Record<string, unknown>)['mcpServers'];
      if (typeof servers === 'object' && servers !== null) {
        for (const name of Object.keys(servers)) add(name, projectPath);
      }
    }
  }

  return [...scopes.entries()].map(([name, s]) => ({ name, scopes: s }));
}
