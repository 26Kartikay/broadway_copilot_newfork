// All requests go through the Express proxy at /analytics-api → analytics-api:8000/api
const BASE = '/analytics-api';

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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as any).detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const analyticsApi = {
  getSchema: () => apiFetch<SchemaResponse>('/schema'),
  query: (question: string) =>
    apiFetch<QueryResponse>('/query', { method: 'POST', body: JSON.stringify({ question }) }),
  runSQL: (sql: string, question = 'Custom SQL') =>
    apiFetch<QueryResponse>('/query/sql', { method: 'POST', body: JSON.stringify({ sql, question }) }),
};
