import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { QueryResponse } from './analyticsApi';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

interface Props { result: QueryResponse; }

function TableView({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="text-muted text-sm" style={{ textAlign: 'center', padding: '2rem' }}>No results</p>;
  return (
    <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto' }}>
      <table className="table">
        <thead>
          <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map(c => <td key={c} style={{ fontSize: '0.8125rem' }}>{String(row[c] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartRenderer({ result }: Props) {
  const { chart, rows, columns } = result;
  const h = 300;

  if (chart.chart_type === 'table' || !chart.x_axis || !chart.y_axis || rows.length === 0) {
    return <TableView columns={columns} rows={rows} />;
  }

  const tooltipStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)',
    color: 'var(--color-text)',
  };

  if (chart.chart_type === 'bar') return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 40, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey={chart.x_axis} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} angle={-30} textAnchor="end" />
        <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend />
        <Bar dataKey={chart.y_axis} fill={COLORS[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );

  if (chart.chart_type === 'line') return (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 40, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey={chart.x_axis} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} angle={-30} textAnchor="end" />
        <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend />
        <Line type="monotone" dataKey={chart.y_axis} stroke={COLORS[0]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );

  if (chart.chart_type === 'pie') return (
    <ResponsiveContainer width="100%" height={h}>
      <PieChart>
        <Pie data={rows} dataKey={chart.y_axis} nameKey={chart.x_axis} cx="50%" cy="50%" outerRadius={110}
          label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );

  if (chart.chart_type === 'scatter') return (
    <ResponsiveContainer width="100%" height={h}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey={chart.x_axis} name={chart.x_axis} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} />
        <YAxis dataKey={chart.y_axis} name={chart.y_axis} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
        <Scatter data={rows} fill={COLORS[0]} />
      </ScatterChart>
    </ResponsiveContainer>
  );

  return <TableView columns={columns} rows={rows} />;
}
