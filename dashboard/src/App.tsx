import { Activity, BarChart2, LayoutDashboard, LogOut, Search, Settings, Trash2, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, ApiRequestLog, ServiceLog, User } from './api.ts';
import { AnalyticsPage } from './analytics/AnalyticsPage.tsx';

type DatePreset = 'all' | '24h' | '7d' | '30d' | 'custom';

function buildCreatedRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { createdAfter?: string; createdBefore?: string } {
  const now = Date.now();
  if (preset === 'all') return {};
  if (preset === '24h') return { createdAfter: new Date(now - 24 * 60 * 60 * 1000).toISOString() };
  if (preset === '7d') return { createdAfter: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() };
  if (preset === '30d') return { createdAfter: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() };
  const out: { createdAfter?: string; createdBefore?: string } = {};
  const f = customFrom.trim();
  const t = customTo.trim();
  if (f) {
    const d = new Date(f);
    if (!Number.isNaN(d.getTime())) out.createdAfter = d.toISOString();
  }
  if (t) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) out.createdBefore = d.toISOString();
  }
  return out;
}

const Dashboard = () => {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(console.error);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Service Health</h1>
      <div className="flex gap-6">
        <div className="card w-full">
          <h3 className="text-muted text-sm mb-1 uppercase tracking-wider">Database</h3>
          <p className="text-xl font-semibold flex items-center gap-2">
            {health?.db === 'connected' ? (
              <><span className="badge badge-success">Online</span> Postgres</>
            ) : (
              <><span className="badge badge-error">Offline</span> Postgres</>
            )}
          </p>
        </div>
        <div className="card w-full">
          <h3 className="text-muted text-sm mb-1 uppercase tracking-wider">Redis</h3>
          <p className="text-xl font-semibold flex items-center gap-2">
            {health?.redis === 'connected' ? (
              <><span className="badge badge-success">Online</span> Cache</>
            ) : (
              <><span className="badge badge-error">Offline</span> Cache</>
            )}
          </p>
        </div>
        <div className="card w-full">
          <h3 className="text-muted text-sm mb-1 uppercase tracking-wider">Build Version</h3>
          <p className="text-xl font-semibold">{health?.version || '1.0.0-beta'}</p>
        </div>
      </div>
    </div>
  );
};

const LogsPage = () => {
  const [logSource, setLogSource] = useState<'service' | 'api'>('api');
  const [serviceLogs, setServiceLogs] = useState<ServiceLog[]>([]);
  const [apiLogs, setApiLogs] = useState<ApiRequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<string>('ALL');
  const [userFilter, setUserFilter] = useState('');
  const [search, setSearch] = useState('');
  const [serviceNameFilter, setServiceNameFilter] = useState('');
  const [endpointFilter, setEndpointFilter] = useState('');
  const [httpStatusFilter, setHttpStatusFilter] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const range = buildCreatedRange(datePreset, customFrom, customTo);
      const common = {
        severity: severity === 'ALL' ? undefined : severity,
        userId: userFilter.trim() || undefined,
        search: search.trim() || undefined,
        limit: '100',
        ...range,
      };
      if (logSource === 'service') {
        void api
          .getLogs({
            ...common,
            service: serviceNameFilter.trim() || undefined,
          })
          .then(setServiceLogs)
          .finally(() => setLoading(false));
      } else {
        void api
          .getApiRequestLogs({
            ...common,
            endpoint: endpointFilter.trim() || undefined,
            httpStatus: httpStatusFilter.trim() || undefined,
          })
          .then(setApiLogs)
          .finally(() => setLoading(false));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [
    logSource,
    severity,
    userFilter,
    search,
    serviceNameFilter,
    endpointFilter,
    httpStatusFilter,
    datePreset,
    customFrom,
    customTo,
  ]);

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'ERROR': case 'CRITICAL': return 'badge-error';
      case 'WARNING': return 'badge-warning';
      case 'INFO': return 'badge-info';
      case 'SUCCESS': return 'badge-success';
      default: return 'badge-secondary';
    }
  };

  const userCellService = (log: ServiceLog) => {
    const label =
      log.user?.profileName ||
      log.profileNameSnapshot ||
      log.appUserId ||
      (log.userId ? `${log.userId.slice(0, 8)}…` : null);
    const searchParam = log.userId || log.appUserId || log.whatsappId || '';
    if (!label) return <span className="text-muted">—</span>;
    return (
      <NavLink
        to={`/users?search=${encodeURIComponent(searchParam)}`}
        className="underline font-mono text-xs"
        style={{ color: 'var(--color-primary)' }}
        title={log.userId || log.appUserId || ''}
      >
        {label}
      </NavLink>
    );
  };

  const userCellApi = (log: ApiRequestLog) => {
    const label =
      log.user?.profileName || log.userName || (log.userId ? `${log.userId.slice(0, 8)}…` : null);
    const searchParam = log.userId || log.user?.appUserId || log.user?.whatsappId || '';
    if (!label) return <span className="text-muted">—</span>;
    return (
      <NavLink
        to={searchParam ? `/users?search=${encodeURIComponent(searchParam)}` : '/users'}
        className="underline font-mono text-xs"
        style={{ color: 'var(--color-primary)' }}
        title={log.userId || log.user?.appUserId || ''}
      >
        {label}
      </NavLink>
    );
  };

  const exportName = logSource === 'service' ? 'service-logs' : 'api-request-logs';

  const downloadJson = (data: unknown, suffix: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}-${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportFilteredUpTo10k = async () => {
    setExporting(true);
    try {
      const range = buildCreatedRange(datePreset, customFrom, customTo);
      const base = {
        severity: severity === 'ALL' ? undefined : severity,
        userId: userFilter.trim() || undefined,
        search: search.trim() || undefined,
        limit: '10000',
        offset: '0',
        ...range,
      };
      const data =
        logSource === 'service'
          ? await api.getLogs({
              ...base,
              service: serviceNameFilter.trim() || undefined,
            })
          : await api.getApiRequestLogs({
              ...base,
              endpoint: endpointFilter.trim() || undefined,
              httpStatus: httpStatusFilter.trim() || undefined,
            });
      downloadJson(data, 'export');
    } catch (e) {
      console.error(e);
      alert('Export failed — see console.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6" style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h1 className="text-2xl font-bold">Logs</h1>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex rounded border border-color-border overflow-hidden">
              <button
                type="button"
                className={`px-3 py-2 text-sm ${logSource === 'service' ? 'bg-primary text-white' : 'bg-surface'}`}
                onClick={() => setLogSource('service')}
              >
                Service logs
              </button>
              <button
                type="button"
                className={`px-3 py-2 text-sm ${logSource === 'api' ? 'bg-primary text-white' : 'bg-surface'}`}
                onClick={() => setLogSource('api')}
              >
                API / HTTP logs
              </button>
            </div>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="ALL">All severities</option>
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={datePreset}
              title="Filter rows by time range"
              onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            >
              <option value="all">All time</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range…</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={exporting}
              onClick={() => void exportFilteredUpTo10k()}
            >
              {exporting ? 'Exporting…' : 'Export JSON (filtered, up to 10k)'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 border rounded p-1 flex-1 min-w-[200px]" style={{ backgroundColor: 'var(--color-surface)' }}>
            <Search size={18} className="text-muted ml-2 shrink-0" />
            <input
              type="text"
              className="input"
              style={{ border: 'none', padding: '0.25rem', flex: 1 }}
              placeholder={
                logSource === 'service'
                  ? 'Search message, trace id, app user id, phone, name…'
                  : 'Search endpoint, intent, inference text, error, request id…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <input
            type="text"
            className="input"
            style={{ maxWidth: '280px' }}
            placeholder="User: internal id, app id, or WA id"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
          {logSource === 'service' ? (
            <input
              type="text"
              className="input"
              style={{ maxWidth: '200px' }}
              placeholder="Service name (e.g. api, agent)"
              value={serviceNameFilter}
              onChange={(e) => setServiceNameFilter(e.target.value)}
            />
          ) : (
            <>
              <input
                type="text"
                className="input"
                style={{ maxWidth: '220px' }}
                placeholder="Endpoint contains (e.g. /api/chat)"
                value={endpointFilter}
                onChange={(e) => setEndpointFilter(e.target.value)}
              />
              <input
                type="text"
                className="input"
                style={{ maxWidth: '100px' }}
                placeholder="HTTP 200"
                value={httpStatusFilter}
                onChange={(e) => setHttpStatusFilter(e.target.value)}
              />
            </>
          )}
        </div>
        {datePreset === 'custom' && (
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="text-muted">From</span>
            <input
              type="datetime-local"
              className="input"
              style={{ maxWidth: '200px' }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-muted">To</span>
            <input
              type="datetime-local"
              className="input"
              style={{ maxWidth: '200px' }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>
      {logSource === 'service' ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: '100%' }}>
          <div style={{ overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' }}>
          <table className="table" style={{ minWidth: '900px', width: '100%' }}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Severity</th>
                <th>Service</th>
                <th>Message</th>
                <th>User</th>
                <th>Trace ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center' }}>Loading...</td></tr>
              ) : serviceLogs.length > 0 ? serviceLogs.map((log) => (
                <tr key={log.id} className="text-sm">
                  <td className="text-muted">{new Date(log.createdAt).toLocaleString()}</td>
                  <td><span className={`badge ${severityColor(log.severity)}`}>{log.severity}</span></td>
                  <td><span className="text-muted">{log.service}</span></td>
                  <td style={{ maxWidth: '400px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.message}>
                    {log.message}
                  </td>
                  <td>{userCellService(log)}</td>
                  <td className="text-muted text-xs">{log.traceId || '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No service logs found.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: '100%' }}>
          <div style={{ overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' }}>
          <table className="table" style={{ minWidth: '1200px', width: '100%' }}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Severity</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Latency</th>
                <th>User</th>
                <th>Intent</th>
                <th>Inference (intent v2)</th>
                <th>Error</th>
                <th>Request / response</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ textAlign: 'center' }}>Loading...</td></tr>
              ) : apiLogs.length > 0 ? apiLogs.map((log) => (
                <tr key={log.id} className="text-sm">
                  <td className="text-muted whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                  <td><span className={`badge ${severityColor(log.severity)}`}>{log.severity}</span></td>
                  <td className="font-mono text-xs" title={log.endpoint}>{log.endpoint}</td>
                  <td>{log.httpStatus}</td>
                  <td>{log.latencyMs} ms</td>
                  <td>{userCellApi(log)}</td>
                  <td className="text-xs">{log.intent || '—'}</td>
                  <td
                    className="text-xs max-w-[220px]"
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={log.intentV2 || ''}
                  >
                    {log.intentV2 || '—'}
                  </td>
                  <td
                    className="text-xs text-error max-w-[180px]"
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={log.error || ''}
                  >
                    {log.error || '—'}
                  </td>
                  <td className="align-top max-w-[min(360px,40vw)] text-xs">
                    <details className="mb-1">
                      <summary className="cursor-pointer" style={{ color: 'var(--color-primary)' }}>Request</summary>
                      <pre className="mt-1 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap break-words" style={{ backgroundColor: 'var(--color-surface)', fontSize: '0.7rem' }}>
                        {log.requestPayload != null ? JSON.stringify(log.requestPayload, null, 2) : '—'}
                      </pre>
                    </details>
                    <details>
                      <summary className="cursor-pointer" style={{ color: 'var(--color-primary)' }}>Response</summary>
                      <pre className="mt-1 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap break-words" style={{ backgroundColor: 'var(--color-surface)', fontSize: '0.7rem' }}>
                        {log.responsePayload != null ? JSON.stringify(log.responsePayload, null, 2) : '—'}
                      </pre>
                    </details>
                  </td>
                  <td className="text-muted text-xs font-mono">{log.requestId || '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No API request logs found.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
};

const UsersPage = () => {
  const [searchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') ?? '';
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState(urlSearch);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      api.getUsers(search).then(setUsers).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [search]);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this user? This action is irreversible.')) {
      await api.deleteUser(id);
      setUsers(users.filter(u => u.id !== id));
    }
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a CSV file first.');
      return;
    }
    setUploading(true);
    try {
      const result = await api.bulkCreateUsers(file);
      setUploadResult(result);
      // Refresh user list
      api.getUsers(search).then(setUsers);
      setFile(null);
      // Reset file input
      const fileInput = document.getElementById('bulk-user-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (e) {
      console.error('Upload failed', e);
      alert(e instanceof Error ? e.message : 'Upload failed. Check the console for details.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">User Operations</h1>
        <div className="flex gap-4">
          <button 
            className="btn btn-secondary" 
            onClick={() => setShowBulkUpload(!showBulkUpload)}
          >
            {showBulkUpload ? 'Hide Bulk Upload' : 'Bulk Upload Users'}
          </button>
          <div className="flex items-center gap-2 border rounded p-1" style={{ backgroundColor: 'var(--color-surface)' }}>
            <Search size={18} className="text-muted ml-2" />
            <input 
              type="text" 
              placeholder="Search user..." 
              className="input" 
              style={{ border: 'none', padding: '0.25rem' }} 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary">Create User</button>
        </div>
      </div>

      {showBulkUpload && (
        <div className="card mb-6" style={{ border: '1px solid var(--color-border)' }}>
          <h2 className="text-lg font-semibold mb-2">Bulk upload users (CSV)</h2>
          <p className="text-sm text-muted mb-2">
            Required: <code className="bg-surface px-1 rounded">app_user_id</code> (or <code className="bg-surface px-1 rounded">user_id</code>),{' '}
            <code className="bg-surface px-1 rounded">name</code> or <code className="bg-surface px-1 rounded">profile_name</code>.
            Optional (nullable / omit): <code className="bg-surface px-1 rounded">whatsapp_id</code> (defaults to{' '}
            <code className="bg-surface px-1 rounded">bulk-wa:&lt;app_user_id&gt;</code>),{' '}
            <code className="bg-surface px-1 rounded">gender</code> (<code>MALE</code>, <code>FEMALE</code>, <code>OTHER</code>),{' '}
            <code className="bg-surface px-1 rounded">age_group</code> (<code>TEEN</code>, <code>ADULT</code>, <code>SENIOR</code> — Prisma enum, not a number),{' '}
            <code className="bg-surface px-1 rounded">details</code>, <code className="bg-surface px-1 rounded">is_guest</code>.
          </p>
          
          <div className="flex flex-col gap-4">
            <div className="bg-surface p-4 rounded text-xs font-mono border border-color-border">
              <p className="text-muted mb-1">Example (headers are case-insensitive; spaces → underscores):</p>
              app_user_id,name,gender,age_group,whatsapp_id,details,is_guest<br/>
              acme_001,Alice Smith,FEMALE,ADULT,whatsapp:+919876543210,,false<br/>
              acme_002,Bob Jones,MALE,TEEN,,,true
            </div>

            <div className="flex items-center gap-4">
              <input 
                id="bulk-user-upload"
                type="file" 
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:opacity-90"
              />
              <button 
                className="btn btn-primary" 
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                {uploading ? 'Uploading...' : 'Upload CSV'}
              </button>
            </div>

            {uploadResult && (
              <div className={`mt-2 p-3 rounded text-sm ${uploadResult.errors > 0 ? 'bg-error-light text-error' : 'bg-success-light text-success'}`} style={{ backgroundColor: uploadResult.errors > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)' }}>
                <strong>Upload summary:</strong>{' '}
                {uploadResult.succeeded ?? uploadResult.created} succeeded, {uploadResult.errors} errors
                {uploadResult.total !== undefined ? ` (${uploadResult.total} rows).` : '.'}
                {uploadResult.details?.length > 0 && (
                  <ul className="mt-2 list-disc list-inside">
                    {uploadResult.details.slice(0, 8).map((d: { user: string; error: string }, i: number) => (
                      <li key={i}>{d.user}: {d.error}</li>
                    ))}
                    {uploadResult.details.length > 8 && <li>…and {uploadResult.details.length - 8} more.</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Internal ID</th>
              <th>App user ID</th>
              <th>WhatsApp ID</th>
              <th>Name</th>
              <th>Gender</th>
              <th>Age group</th>
              <th>Type</th>
              <th>Created</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center' }}>Loading...</td></tr>
            ) : Array.isArray(users) && users.length > 0 ? users.map(user => (
              <tr key={user.id} className="text-sm">
                <td className="text-muted text-xs font-mono">{user.id}</td>
                <td className="font-mono text-xs">{user.appUserId}</td>
                <td className="text-xs">{user.whatsappId}</td>
                <td className="font-medium">{user.profileName || '—'}</td>
                <td className="text-muted text-xs">{user.confirmedGender ?? '—'}</td>
                <td className="text-muted text-xs">{user.confirmedAgeGroup ?? '—'}</td>
                <td><span className="badge badge-secondary">{user.isGuest ? 'Guest' : 'User'}</span></td>
                <td className="text-muted">{new Date(user.createdAt).toLocaleDateString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => handleDelete(user.id)} className="text-error" style={{ color: 'var(--color-error)', padding: '4px' }}>
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SettingsPage = () => {
  const [chatApiUrl, setChatApiUrl] = useState('');
  const [nodeEnv, setNodeEnv] = useState('');

  useEffect(() => {
    api.getConfig().then((c) => {
      setChatApiUrl(c.chatApiUrl || '');
      setNodeEnv(c.nodeEnv || '');
    });
  }, []);

  return (
  <div className="p-6">
    <h1 className="text-2xl font-bold mb-6">Admin Settings</h1>
    <div className="card" style={{ maxWidth: '600px' }}>
      <div className="mb-4">
        <label className="text-sm font-medium text-muted block mb-1">Chat API base URL</label>
        <input
          type="text"
          className="input"
          value={chatApiUrl}
          placeholder="Set CHAT_API_URL or SERVER_URL on the dashboard container"
          readOnly
        />
        <p className="text-xs text-muted mt-1">From container env: <code>CHAT_API_URL</code>, else <code>SERVER_URL</code>.</p>
      </div>
      <div className="mb-4">
        <label className="text-sm font-medium text-muted block mb-1">Environment</label>
        <p className="font-semibold flex items-center gap-2">
          {nodeEnv || '—'} <span className="badge badge-secondary">dashboard server</span>
        </p>
      </div>
      <div className="mb-6">
        <label className="text-sm font-medium text-muted block mb-1">Audit Logs</label>
        <p className="text-sm">All create/delete operations are tracked in <code>AdminAuditLog</code>.</p>
      </div>
      <button className="btn btn-secondary w-full" disabled>OpenAPI Documentation</button>
    </div>
  </div>
  );
};

const App: React.FC = () => {
  const [env] = useState('production');

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="p-6 flex items-center gap-4">
          <img 
            src="https://shop.broadwaylive.in/cdn/shop/files/Broadway-Equalizer_01.gif?v=1771314744&width=400" 
            alt="Broadway Logo" 
            className="logo"
          />
          <h2 className="font-bold text-lg tracking-tight">Broadway</h2>
        </div>
        
        <nav className="flex-col flex flex-1">
          <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={20} /> Dashboard
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Activity size={20} /> Logs
          </NavLink>
          <NavLink to="/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Users size={20} /> Users
          </NavLink>
          <NavLink to="/analytics" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BarChart2 size={20} /> Analytics
          </NavLink>
        </nav>

        <div className="mt-auto border-t border-color-border p-4">
          <NavLink to="/settings" className="nav-item">
            <Settings size={20} /> Settings
          </NavLink>
          <button className="nav-item w-full text-left" style={{ color: 'var(--color-error)' }}>
            <LogOut size={20} /> Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div className="flex items-center gap-4">
            <span className={`badge ${env === 'production' ? 'badge-error' : 'badge-warning'}`}>
              {env.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Admin Operator</span>
            <div 
              style={{ width: '32px', height: '32px', backgroundColor: 'var(--color-secondary)', borderRadius: '50%' }}
            />
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/analytics" element={<div className="analytics-fill"><AnalyticsPage /></div>} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
