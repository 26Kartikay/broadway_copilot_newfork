import { BarChart3, ChevronDown, ChevronUp, Code2, Lightbulb, X } from 'lucide-react';
import { useState } from 'react';
import type { QueryResponse } from './analyticsApi';
import { ChartRenderer } from './ChartRenderer';

interface Props { result: QueryResponse; onRemove: () => void; }

export function ResultCard({ result, onRemove }: Props) {
  const [showSQL, setShowSQL] = useState(false);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <BarChart3 size={14} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{result.chart.title}</span>
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem' }}>{result.chart.description}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <span className="badge" style={{ background: 'var(--color-secondary)', color: 'var(--color-secondary-text)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {result.chart.chart_type}
          </span>
          <span className="text-muted" style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{result.row_count} rows</span>
          <button onClick={onRemove} style={{ color: 'var(--color-text-muted)', padding: '2px', borderRadius: 'var(--radius)', background: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: '1.25rem' }}>
        <ChartRenderer result={result} />
      </div>

      {/* Insight */}
      {result.insight && (
        <div style={{ padding: '0 1.25rem 1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--color-secondary)', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
            <Lightbulb size={14} style={{ color: 'var(--color-info)', flexShrink: 0, marginTop: '2px' }} />
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.5 }}>{result.insight}</p>
          </div>
        </div>
      )}

      {/* SQL toggle */}
      <div style={{ padding: '0 1.25rem 1rem' }}>
        <button
          onClick={() => setShowSQL(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer' }}
        >
          <Code2 size={12} />
          {showSQL ? 'Hide SQL' : 'Show SQL'}
          {showSQL ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showSQL && (
          <pre style={{ marginTop: '0.5rem', background: 'var(--color-secondary)', borderRadius: 'var(--radius)', padding: '0.75rem', fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--color-text)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {result.sql}
          </pre>
        )}
      </div>
    </div>
  );
}
