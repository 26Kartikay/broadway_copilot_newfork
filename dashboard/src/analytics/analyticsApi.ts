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

export const analyticsApi = {
  listDatabases: () => apiFetch<{ databases: DatabaseOption[] }>('/databases'),

  getSchema: (databaseId?: string) => apiFetch<SchemaResponse>('/schema', undefined, databaseId),

  query: (question: string, databaseId?: string) =>
    apiFetch<QueryResponse>(
      '/query',
      {
        method: 'POST',
        body: JSON.stringify({ question, database_id: databaseId }),
      },
      databaseId,
    ),

  runSQL: (sql: string, question = 'Custom SQL', databaseId?: string) =>
    apiFetch<QueryResponse>(
      '/query/sql',
      {
        method: 'POST',
        body: JSON.stringify({ sql, question, database_id: databaseId }),
      },
      databaseId,
    ),
};
