import { Code2, Loader2, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { analyticsApi, type QueryResponse } from './analyticsApi';

const SUGGESTIONS = [
  'Total users by gender',
  'Daily messages over last 30 days',
  'Top 10 most active users',
  'API errors by endpoint this week',
  'User signups by month',
];

interface Props {
  onResult: (r: QueryResponse) => void;
  /** Selected analytics DB id (must match server registry). */
  databaseId: string | null;
}

export function QueryPanel({ onResult, databaseId }: Props) {
  const [question, setQuestion] = useState('');
  const [sqlMode, setSqlMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || !databaseId) return;
    setLoading(true);
    setError(null);
    try {
      const result = sqlMode
        ? await analyticsApi.runSQL(text, 'Custom SQL', databaseId)
        : await analyticsApi.query(text, databaseId);
      onResult(result);
      if (!q) setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {(['nl', 'sql'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setSqlMode(mode === 'sql')}
            className={`btn btn-${(mode === 'sql') === sqlMode ? 'primary' : 'secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
          >
            {mode === 'nl' ? <><Sparkles size={11} /> Natural language</> : <><Code2 size={11} /> Raw SQL</>}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ position: 'relative' }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder={sqlMode ? 'SELECT * FROM ...' : 'Ask anything about your data…'}
          rows={sqlMode ? 4 : 2}
          className="input"
          style={{ paddingRight: '3rem', fontFamily: sqlMode ? 'monospace' : 'inherit', resize: 'none' }}
        />
        <button
          onClick={() => submit()}
          disabled={loading || !question.trim() || !databaseId}
          className="btn btn-primary"
          style={{ position: 'absolute', right: '0.5rem', bottom: '0.5rem', padding: '0.375rem', display: 'flex', alignItems: 'center' }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-error)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '0.5rem 0.75rem' }}>
          {error}
        </div>
      )}

      {!sqlMode && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => { setQuestion(s); submit(s); }}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
