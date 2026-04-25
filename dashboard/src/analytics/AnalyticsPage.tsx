import { RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { analyticsApi, type QueryResponse, type TableSchema } from './analyticsApi';
import { DashboardGrid } from './DashboardGrid';
import { QueryPanel } from './QueryPanel';
import { SchemaExplorer } from './SchemaExplorer';

interface Item { id: string; result: QueryResponse; }
let _id = 1;

export function AnalyticsPage() {
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const loadSchema = () => {
    analyticsApi.getSchema()
      .then(r => { setSchema(r.tables); setSchemaError(null); })
      .catch(e => setSchemaError(e.message));
  };

  useEffect(() => { loadSchema(); }, []);

  const addResult = (result: QueryResponse) =>
    setItems(prev => [{ id: String(_id++), result }, ...prev]);

  const handleColumnClick = (table: string, column: string) => {
    analyticsApi.query(`Distribution of ${column} in ${table}`).then(addResult).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Schema sidebar */}
      <aside style={{ width: '220px', borderRight: '1px solid var(--color-border)', padding: '1.25rem', overflowY: 'auto', flexShrink: 0 }}>
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
          <QueryPanel onResult={addResult} />
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.5rem 1.5rem 3rem' }}>
          <DashboardGrid items={items} onReorder={setItems} onRemove={id => setItems(p => p.filter(i => i.id !== id))} />
        </div>
      </div>
    </div>
  );
}
