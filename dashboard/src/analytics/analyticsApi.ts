// All requests go through the Express proxy at /analytics-api → analytics-api:8000/api
const BASE = '/analytics-api';

export interface DatabaseOption {
  id: string;
  label: string;
}

export interface ColumnMeta { name: string; type: string; }
export interface TableSchema { table: string; columns: ColumnMeta[]; }
export interface SchemaResponse { tables: TableSchema[]; }
export interface ChartConfig {
  chart_type: 'bar' | 'line' | 'pie' | 'scatter' | 'table';
  x_axis: string | null;
  y_axis: string | null;
  title: string;
  description: string;
}
export interface QueryResponse {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  chart: ChartConfig;
  insight: string | null;
}

// ── Agent Loop Types ──────────────────────────────────────────────────────────

export type LoopStep =
  | 'idle'
  | 'parsing'
  | 'exploring'
  | 'implementing'
  | 'validating'
  | 'refining'
  | 'complete'
  | 'error';

export interface LoopLog {
  id: string;
  step: string;
  status: 'in-progress' | 'success' | 'failed';
  message: string;
  timestamp: number;
  duration?: number;
  details?: Record<string, unknown>;
}

export interface AgentImplementation {
  sql: string;
  chart_type: string;
  title: string;
  x_axis: string | null;
  y_axis: string | null;
  description: string;
  changes_made?: string;
}

export interface AgentValidationResult {
  isValid: boolean;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  executionTimeMs: number;
  insight: string | null;
}

export interface AgentLoopState {
  step: LoopStep;
  userQuery: string;
  iterationCount: number;
  maxIterations: number;
  logs: LoopLog[];
  implementation?: AgentImplementation;
  validationResult?: AgentValidationResult;
  errorMessage?: string;
  fallback?: boolean;
  startTime: number;
}

// Events streamed from backend
export type AgentEvent =
  | { type: 'state'; step: string; iterationCount: number; maxIterations: number }
  | { type: 'log'; log: LoopLog }
  | {
      type: 'complete';
      step: 'complete' | 'error';
      implementation?: AgentImplementation;
      validationResult?: AgentValidationResult;
      errorMessage?: string;
      iterationCount?: number;
      fallback?: boolean;
    };

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function buildHeaders(databaseId: string | undefined, init?: HeadersInit): Headers {
  const h = new Headers(init);
  if (!h.has('Content-Type')) {
    h.set('Content-Type', 'application/json');
  }
  if (databaseId) {
    h.set('X-Analytics-Database', databaseId);
  }
  return h;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  databaseId?: string,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: buildHeaders(databaseId, options?.headers),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = (err as { detail?: unknown }).detail;
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? JSON.stringify(detail)
          : `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Streaming agent query ─────────────────────────────────────────────────────

async function* streamAgentQuery(
  question: string,
  databaseId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${BASE}/agent/query`, {
    method: 'POST',
    headers: buildHeaders(databaseId),
    body: JSON.stringify({ question, database_id: databaseId }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = (err as { detail?: unknown }).detail;
    const msg = typeof detail === 'string' ? detail : `Agent query failed: ${res.status}`;
    throw new Error(msg);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield JSON.parse(trimmed) as AgentEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer.trim()) as AgentEvent;
}

// ── API surface ───────────────────────────────────────────────────────────────

export const analyticsApi = {
  listDatabases: () => apiFetch<{ databases: DatabaseOption[] }>('/databases'),

  getSchema: (databaseId?: string) => apiFetch<SchemaResponse>('/schema', undefined, databaseId),

  query: (question: string, databaseId?: string, signal?: AbortSignal) =>
    apiFetch<QueryResponse>(
      '/query',
      {
        method: 'POST',
        body: JSON.stringify({ question, database_id: databaseId }),
        ...(signal ? { signal } : {}),
      },
      databaseId,
    ),

  runSQL: (sql: string, question = 'Custom SQL', databaseId?: string, signal?: AbortSignal) =>
    apiFetch<QueryResponse>(
      '/query/sql',
      {
        method: 'POST',
        body: JSON.stringify({ sql, question, database_id: databaseId }),
        ...(signal ? { signal } : {}),
      },
      databaseId,
    ),

  agentQuery: streamAgentQuery,
};
