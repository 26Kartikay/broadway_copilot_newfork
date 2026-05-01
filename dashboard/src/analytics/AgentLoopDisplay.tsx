import {
  CheckCircle2,
  Code2,
  Database,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { AgentLoopState, LoopLog, LoopStep } from './analyticsApi';

// ── Step metadata ─────────────────────────────────────────────────────────────

const ORDERED_STEPS: Array<Exclude<LoopStep, 'idle' | 'error' | 'complete'>> = [
  'parsing',
  'exploring',
  'implementing',
  'validating',
  'refining',
];

const STEP_META: Record<string, { label: string; Icon: React.FC<{ size?: number; className?: string; color?: string }> }> = {
  parsing:      { label: 'Parsing Query',        Icon: Search },
  exploring:    { label: 'Exploring Schema',      Icon: Database },
  implementing: { label: 'Generating SQL',        Icon: Code2 },
  validating:   { label: 'Validating Result',     Icon: Shield },
  refining:     { label: 'Refining',              Icon: RefreshCw },
  complete:     { label: 'Complete',              Icon: CheckCircle2 },
  error:        { label: 'Error',                 Icon: XCircle },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedLabel(startTime: number): string {
  const s = Math.floor((Date.now() - startTime) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function durationLabel(ms?: number): string {
  if (!ms) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function stepStatusOf(
  stepName: string,
  currentStep: LoopStep,
  logs: LoopLog[],
): 'pending' | 'in-progress' | 'success' | 'failed' {
  const hasSuccess = logs.some(l => l.step === stepName && l.status === 'success');
  const hasFailed  = logs.some(l => l.step === stepName && l.status === 'failed');
  if (hasSuccess) return 'success';
  if (hasFailed)  return 'failed';
  if (currentStep === stepName) return 'in-progress';
  return 'pending';
}

// ── Step indicator dot ────────────────────────────────────────────────────────

function StepDot({ status }: { status: 'pending' | 'in-progress' | 'success' | 'failed' }) {
  const map = {
    pending:     { bg: '#2a2a2a', color: '#666', border: '1px solid #333' },
    'in-progress': { bg: '#75CFE7', color: '#0a0a0a', border: 'none' },
    success:     { bg: '#20DB02', color: '#0a0a0a', border: 'none' },
    failed:      { bg: '#EB1D0F', color: '#fff',    border: 'none' },
  }[status];

  return (
    <span
      style={{
        width: 22, height: 22, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontSize: 11, fontWeight: 700,
        background: map.bg, color: map.color, border: map.border,
      }}
    >
      {status === 'in-progress' ? (
        <Loader2 size={11} className="spin" />
      ) : status === 'success' ? (
        '✓'
      ) : status === 'failed' ? (
        '✗'
      ) : (
        '·'
      )}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ iteration, max, step }: { iteration: number; max: number; step: LoopStep }) {
  const pct = step === 'complete' ? 100 : step === 'error' ? 100 : Math.min((iteration / max) * 100, 90);
  const color = step === 'error' ? '#EB1D0F' : step === 'complete' ? '#20DB02' : '#75CFE7';
  return (
    <div style={{ width: '100%', height: 3, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, #75CFE7, ${color})`,
          transition: 'width 0.4s ease',
          borderRadius: 2,
        }}
      />
    </div>
  );
}

// ── Log entry ─────────────────────────────────────────────────────────────────

function LogEntry({ log }: { log: LoopLog }) {
  const color =
    log.status === 'success' ? '#20DB02' :
    log.status === 'failed'  ? '#EB1D0F' : '#75CFE7';

  const ts = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{
      padding: '4px 0',
      borderBottom: '1px solid #111',
      display: 'flex', alignItems: 'flex-start', gap: 6,
      fontSize: 11, lineHeight: 1.5, fontFamily: 'var(--font-mono)',
    }}>
      <span style={{ color: '#444', flexShrink: 0, fontSize: 10 }}>{ts}</span>
      <span style={{ color, flexShrink: 0, textTransform: 'uppercase', fontSize: 10 }}>[{log.step}]</span>
      <span style={{ color: '#ccc', flex: 1 }}>{log.message}</span>
      {log.duration !== undefined && log.duration > 0 && (
        <span style={{ color: '#555', flexShrink: 0, fontSize: 10 }}>{durationLabel(log.duration)}</span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  state: AgentLoopState;
  onRetry: () => void;
  onCancel: () => void;
}

export function AgentLoopDisplay({ state, onRetry, onCancel }: Props) {
  const { step, iterationCount, maxIterations, logs, errorMessage, startTime, fallback } = state;
  const isActive = step !== 'complete' && step !== 'error' && step !== 'idle';
  const isError  = step === 'error';
  const isDone   = step === 'complete';

  // When refining, collapse the repeat into a condensed view
  const displaySteps: string[] = step === 'refining'
    ? ['parsing', 'exploring', 'implementing', 'refining', 'validating']
    : ORDERED_STEPS;

  return (
    <div className="agent-loop-container">
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={14} color="#F5A6F6" />
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 600, color: '#fff' }}>
            Agent Loop
          </span>
          {fallback && (
            <span style={{ fontSize: 10, color: '#F0E071', background: 'rgba(240,224,113,0.1)', padding: '1px 6px', borderRadius: 10 }}>
              FALLBACK
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isActive && (
            <>
              <span style={{ fontSize: 10, color: '#666', fontFamily: 'var(--font-mono)' }}>
                {elapsedLabel(startTime)}
              </span>
              <button
                onClick={onCancel}
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                  background: 'transparent', border: '1px solid #444', color: '#999',
                }}
              >
                Cancel
              </button>
            </>
          )}
          {(isError || isDone) && (
            <button
              onClick={onRetry}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                background: 'transparent', border: '1px solid #444', color: '#999',
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <ProgressBar iteration={iterationCount} max={maxIterations} step={step} />
      {maxIterations > 1 && iterationCount > 0 && (
        <div style={{ fontSize: 10, color: '#555', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          Iteration {iterationCount}/{maxIterations}
        </div>
      )}

      {/* Step track */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {displaySteps.map(stepName => {
          const status = stepStatusOf(stepName, step, logs);
          const meta = STEP_META[stepName];
          const stepLog = [...logs].reverse().find(l => l.step === stepName);

          return (
            <div
              key={stepName}
              className="loop-step"
              style={{
                opacity: status === 'pending' ? 0.4 : 1,
                transition: 'opacity 0.3s',
              }}
            >
              <StepDot status={status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <meta.Icon size={12} color={status === 'in-progress' ? '#75CFE7' : '#888'} />
                  <span className="step-label" style={{ color: status === 'in-progress' ? '#75CFE7' : '#ccc' }}>
                    {meta.label}
                  </span>
                  {stepLog?.duration !== undefined && stepLog.duration > 0 && (
                    <span className="step-duration">{durationLabel(stepLog.duration)}</span>
                  )}
                </div>
                {stepLog && (
                  <div className="step-message">{stepLog.message}</div>
                )}
              </div>
              {status === 'success' && (
                <CheckCircle2 size={13} color="#20DB02" style={{ flexShrink: 0 }} />
              )}
              {status === 'failed' && (
                <XCircle size={13} color="#EB1D0F" style={{ flexShrink: 0 }} />
              )}
            </div>
          );
        })}

        {/* Final state */}
        {isDone && (
          <div className="loop-step" style={{ borderBottom: 'none' }}>
            <StepDot status="success" />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={12} color="#20DB02" />
                <span className="step-label" style={{ color: '#20DB02' }}>Complete</span>
              </div>
              {state.validationResult && (
                <div className="step-message">
                  {state.validationResult.rowCount} rows · {durationLabel(state.validationResult.executionTimeMs)}
                  {state.validationResult.insight && ' · Insight generated'}
                </div>
              )}
            </div>
          </div>
        )}

        {isError && (
          <div className="loop-step" style={{ borderBottom: 'none' }}>
            <StepDot status="failed" />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <XCircle size={12} color="#EB1D0F" />
                <span className="step-label" style={{ color: '#EB1D0F' }}>Failed</span>
              </div>
              {errorMessage && (
                <div className="step-message" style={{ color: '#EB1D0F' }}>{errorMessage}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Live log feed */}
      {logs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Execution Log
          </div>
          <div className="log-viewer">
            {logs.map(log => <LogEntry key={log.id} log={log} />)}
          </div>
        </div>
      )}
    </div>
  );
}
