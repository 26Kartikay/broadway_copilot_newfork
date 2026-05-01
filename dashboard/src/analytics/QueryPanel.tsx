import { Ban, Code2, Loader2, Send, Sparkles, Zap } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  analyticsApi,
  type AgentEvent,
  type AgentLoopState,
  type ChartConfig,
  type QueryResponse,
} from './analyticsApi';

const MAX_QUERY_ATTEMPTS = 3;

const SUGGESTIONS = [
  'Total users by gender',
  'Daily messages over last 30 days',
  'Top 10 most active users',
  'API errors by endpoint this week',
  'User signups by month',
];

interface Props {
  onResult: (r: QueryResponse) => void;
  onLoopState?: (state: AgentLoopState | null) => void;
  databaseId: string | null;
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = window.setTimeout(() => resolve(), ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export function QueryPanel({ onResult, onLoopState, databaseId }: Props) {
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<'nl' | 'sql' | 'agent'>('nl');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptLabel, setAttemptLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submitAgent = async (q: string) => {
    if (!databaseId || !onLoopState) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    const initialState: AgentLoopState = {
      step: 'parsing',
      userQuery: q,
      iterationCount: 0,
      maxIterations: 3,
      logs: [],
      startTime: Date.now(),
    };
    onLoopState(initialState);

    let currentState: AgentLoopState = { ...initialState };

    try {
      for await (const event of analyticsApi.agentQuery(q, databaseId, ac.signal)) {
        if (ac.signal.aborted) return;

        currentState = applyEvent(currentState, event);
        onLoopState({ ...currentState });

        if (event.type === 'complete') {
          if (event.step === 'complete' && event.implementation && event.validationResult) {
            onResult(agentResultToQueryResponse(event.implementation, event.validationResult));
          } else if (event.step === 'error') {
            setError(event.errorMessage ?? 'Agent loop failed');
          }
          break;
        }
      }
    } catch (e) {
      if (isAbortError(e)) {
        onLoopState(null);
        return;
      }
      const msg = e instanceof Error ? e.message : 'Agent loop failed';
      setError(msg);
      onLoopState({ ...currentState, step: 'error', errorMessage: msg });
    } finally {
      setLoading(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const submitDirect = async (q: string) => {
    if (!databaseId) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    setAttemptLabel(null);

    try {
      for (let attempt = 1; attempt <= MAX_QUERY_ATTEMPTS; attempt++) {
        if (ac.signal.aborted) return;
        setAttemptLabel(`Attempt ${attempt} of ${MAX_QUERY_ATTEMPTS}`);

        try {
          const result =
            mode === 'sql'
              ? await analyticsApi.runSQL(q, 'Custom SQL', databaseId, ac.signal)
              : await analyticsApi.query(q, databaseId, ac.signal);

          if (ac.signal.aborted) return;
          onResult(result);
          return;
        } catch (e) {
          if (ac.signal.aborted || isAbortError(e)) return;
          const msg = e instanceof Error ? e.message : 'Something went wrong';
          if (attempt >= MAX_QUERY_ATTEMPTS) { setError(msg); return; }
          try { await delayWithAbort(400, ac.signal); } catch { return; }
        }
      }
    } finally {
      setLoading(false);
      setAttemptLabel(null);
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const submit = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || !databaseId) return;
    if (mode === 'agent') {
      await submitAgent(text);
    } else {
      await submitDirect(text);
    }
    if (!q) setQuestion('');
  };

  const stopQuery = () => {
    abortRef.current?.abort();
    if (mode === 'agent') onLoopState?.(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {(['nl', 'sql', 'agent'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`btn btn-${m === mode ? 'primary' : 'secondary'}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              fontSize: '0.75rem', padding: '0.25rem 0.75rem',
            }}
          >
            {m === 'nl'    && <><Sparkles size={11} /> Natural language</>}
            {m === 'sql'   && <><Code2 size={11} /> Raw SQL</>}
            {m === 'agent' && <><Zap size={11} /> Agent Loop</>}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ position: 'relative' }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder={
            mode === 'sql'   ? 'SELECT * FROM ...' :
            mode === 'agent' ? 'Describe what you want to analyse...' :
            'Ask anything about your data…'
          }
          rows={mode === 'sql' ? 4 : 2}
          className="input"
          style={{
            paddingRight: '3rem',
            fontFamily: mode === 'sql' ? 'monospace' : 'inherit',
            resize: 'none',
            ...(mode === 'agent'
              ? { borderColor: '#75CFE740', boxShadow: '0 0 0 1px #75CFE720' }
              : {}),
          }}
        />
        <button
          type="button"
          onClick={() => submit()}
          disabled={loading || !question.trim() || !databaseId}
          className="btn btn-primary"
          style={{
            position: 'absolute', right: '0.5rem', bottom: '0.5rem',
            padding: '0.375rem', display: 'flex', alignItems: 'center',
            ...(mode === 'agent'
              ? { background: '#75CFE7', color: '#0a0a0a' }
              : {}),
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div>

      {loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '0.75rem', flexWrap: 'wrap',
        }}>
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {mode === 'agent' ? 'Running agent loop…' : (attemptLabel ?? 'Working…')}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={stopQuery}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              fontSize: '0.75rem', padding: '0.25rem 0.65rem',
            }}
          >
            <Ban size={13} /> Stop
          </button>
        </div>
      )}

      {error && (
        <div style={{
          fontSize: '0.8125rem', color: 'var(--color-error)',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius)', padding: '0.5rem 0.75rem',
        }}>
          {error}
        </div>
      )}

      {mode !== 'sql' && (
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyEvent(state: AgentLoopState, event: AgentEvent): AgentLoopState {
  if (event.type === 'state') {
    return {
      ...state,
      step: event.step as AgentLoopState['step'],
      iterationCount: event.iterationCount,
      maxIterations: event.maxIterations,
    };
  }
  if (event.type === 'log') {
    return { ...state, logs: [...state.logs, event.log] };
  }
  if (event.type === 'complete') {
    return {
      ...state,
      step: event.step,
      implementation: event.implementation,
      validationResult: event.validationResult,
      errorMessage: event.errorMessage,
      iterationCount: event.iterationCount ?? state.iterationCount,
      fallback: event.fallback,
    };
  }
  return state;
}

function agentResultToQueryResponse(
  impl: import('./analyticsApi').AgentImplementation,
  vr: import('./analyticsApi').AgentValidationResult,
): QueryResponse {
  return {
    sql: impl.sql || '',
    columns: vr.columns,
    rows: vr.rows,
    row_count: vr.rowCount,
    chart: {
      chart_type: (impl.chart_type as ChartConfig['chart_type']) || 'table',
      x_axis: impl.x_axis,
      y_axis: impl.y_axis,
      title: impl.title || '',
      description: impl.description || '',
    },
    insight: vr.insight,
  };
}
