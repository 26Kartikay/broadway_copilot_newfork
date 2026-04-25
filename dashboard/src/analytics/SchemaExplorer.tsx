import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import { useState } from 'react';
import type { TableSchema } from './analyticsApi';

interface Props {
  tables: TableSchema[];
  onColumnClick?: (table: string, column: string) => void;
}

export function SchemaExplorer({ tables, onColumnClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([tables[0]?.table]));

  const toggle = (t: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(t) ? next.delete(t) : next.add(t);
    return next;
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Database size={14} className="text-muted" />
        <span className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
          Schema
        </span>
      </div>
      {tables.map(t => (
        <div key={t.table} style={{ marginBottom: '2px' }}>
          <button
            onClick={() => toggle(t.table)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%',
              textAlign: 'left', padding: '0.375rem 0.5rem', borderRadius: 'var(--radius)',
              fontSize: '0.8125rem', background: 'none', cursor: 'pointer', color: 'var(--color-text)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {expanded.has(t.table) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span style={{ fontFamily: 'monospace', flex: 1 }}>{t.table}</span>
            <span className="text-muted" style={{ fontSize: '0.7rem' }}>{t.columns.length}</span>
          </button>
          {expanded.has(t.table) && (
            <div style={{ paddingLeft: '1.25rem', marginTop: '1px' }}>
              {t.columns.map(col => (
                <button
                  key={col.name}
                  onClick={() => onColumnClick?.(t.table, col.name)}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left',
                    padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)', background: 'none',
                    cursor: 'pointer', fontSize: '0.75rem', gap: '0.5rem',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-text-muted)', flex: 1 }}>{col.name}</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', opacity: 0.7, maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {col.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
