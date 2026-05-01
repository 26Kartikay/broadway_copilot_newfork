import { RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  analyticsApi,
  type DatabaseOption,
  type QueryResponse,
  type TableSchema,
} from './analyticsApi';
import { DashboardGrid } from './DashboardGrid';
import { QueryPanel } from './QueryPanel';
import { SchemaExplorer } from './SchemaExplorer';

interface Item { id: string; result: QueryResponse; }
let _id = 1;

const STORAGE_KEY = 'analytics-database-id';

export function AnalyticsPage() {
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dbOptions, setDbOptions] = useState<DatabaseOption[]>([]);
  const [selectedDbId, setSelectedDbId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  const loadSchema = useCallback(() => {
    if (!selectedDbId) return;
    analyticsApi
      .getSchema(selectedDbId)
      .then(r => {
        setSchema(r.tables);
        setSchemaError(null);
      })
      .catch(e => setSchemaError(e instanceof Error ? e.message : 'Failed to load schema'));
  }, [selectedDbId]);

  useEffect(() => {
    analyticsApi
      .listDatabases()
      .then(r => {
        setDbOptions(r.databases);
        setDbError(null);
        const ids = new Set(r.databases.map(d => d.id));
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        const pick =
          stored && ids.has(stored) ? stored : r.databases[0]?.id ?? null;
        setSelectedDbId(pick);
        if (pick && typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, pick);
        }
      })
      .catch(e =>
        setDbError(e instanceof Error ? e.message : 'Could not load database list'),
      );
  }, []);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  const addResult = (result: QueryResponse) =>
    setItems(prev => [{ id: String(_id++), result }, ...prev]);

  const handleColumnClick = (table: string, column: string) => {
    if (!selectedDbId) return;
    analyticsApi
      .query(`Distribution of ${column} in ${table}`, selectedDbId)
      .then(addResult)
      .catch(console.error);
  };

  const onDatabaseChange = (id: string) => {
    setSelectedDbId(id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }
    setItems([]);
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Schema sidebar */}
      <aside style={{ width: '220px', borderRight: '1px solid var(--color-border)', padding: '1.25rem', overflowY: 'auto', flexShrink: 0 }}>
        {dbError ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-error)' }}>{dbError}</p>
        ) : dbOptions.length > 0 ? (
          <div style={{ marginBottom: '1rem' }}>
            <label className="text-muted" style={{ display: 'block', fontSize: '0.65rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Database
            </label>
            <select
              className="input"
              style={{ width: '100%', fontSize: '0.8125rem', padding: '0.4rem 0.5rem' }}
              value={selectedDbId ?? ''}
              onChange={e => onDatabaseChange(e.target.value)}
            >
              {dbOptions.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
        ) : null}
        {schemaError ? (
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-error)', marginBottom: '0.5rem' }}>{schemaError}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Make sure the analytics API is running. Check <code>ANALYTICS_API_URL</code> in your env.
            </p>
          </div>
        ) : schema.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.75rem' }}>Loading schema…</p>
        ) : (
          <SchemaExplorer tables={schema} onColumnClick={handleColumnClick} />
        )}
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Query bar */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>AI Query</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {items.length > 0 && (
                <button onClick={() => setItems([])} className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem' }}>
                  <Trash2 size={13} /> Clear all
                </button>
              )}
              <button onClick={loadSchema} className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem' }}>
                <RefreshCw size={13} /> Refresh schema
              </button>
            </div>
          </div>
          <QueryPanel onResult={addResult} databaseId={selectedDbId} />
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.5rem 1.5rem 3rem' }}>
          <DashboardGrid items={items} onReorder={setItems} onRemove={id => setItems(p => p.filter(i => i.id !== id))} />
        </div>
      </div>
    </div>
  );
}
