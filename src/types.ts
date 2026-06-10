export interface CacheCreation {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: CacheCreation;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string };

export interface LogMessage {
  id?: string;
  model?: string;
  role?: string;
  content?: ContentBlock[] | string;
  usage?: Usage;
}

/** One line of a Claude Code session JSONL file. Unknown record types are preserved as-is and skipped. */
export interface LogRecord {
  type: string;
  uuid?: string;
  parentUuid?: string;
  requestId?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  /** set on user records that carry a /compact summary (older log versions) */
  isCompactSummary?: boolean;
  /** e.g. "compact_boundary" on system records (newer log versions) */
  subtype?: string;
  message?: LogMessage;
}

export interface SessionFile {
  /** Absolute path to the .jsonl file */
  path: string;
  /** Claude project directory name, e.g. "C--Users-seydi" */
  project: string;
  /** True when the file is a subagent/workflow transcript rather than a main session */
  isSubagent: boolean;
  /** Session ID of the main session this subagent transcript belongs to */
  parentSession?: string;
  /** Workflow run ID (wf_*) when the transcript belongs to a workflow agent */
  workflowId?: string;
  /** True for agent-*.jsonl transcripts (excludes workflow journal files) */
  isAgentTranscript: boolean;
  sizeBytes: number;
}
