import { Activity, LayoutDashboard, LogOut, Search, Settings, Trash2, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, ServiceLog, User } from './api.ts';

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
  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<string>('ALL');
  const [userFilter, setUserFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api
        .getLogs({
          severity: severity === 'ALL' ? undefined : severity,
          userId: userFilter.trim() || undefined,
          search: search.trim() || undefined,
          limit: '100',
        })
        .then(setLogs)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [severity, userFilter, search]);

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'ERROR': case 'CRITICAL': return 'badge-error';
      case 'WARNING': return 'badge-warning';
      case 'INFO': return 'badge-info';
      case 'SUCCESS': return 'badge-success';
      default: return 'badge-secondary';
    }
  };

  const userCell = (log: ServiceLog) => {
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

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h1 className="text-2xl font-bold">Service Logs</h1>
          <div className="flex gap-2 flex-wrap">
            <select
              className="input"
              style={{ width: 'auto' }}
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="ALL">All Severities</option>
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `service-logs-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Export JSON
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
              placeholder="Search message, trace id, app user id, phone, name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <input
            type="text"
            className="input"
            style={{ maxWidth: '280px' }}
            placeholder="Match user (internal id, app id, or WA id)"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
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
            ) : Array.isArray(logs) && logs.length > 0 ? logs.map(log => (
              <tr key={log.id} className="text-sm">
                <td className="text-muted">{new Date(log.createdAt).toLocaleString()}</td>
                <td><span className={`badge ${severityColor(log.severity)}`}>{log.severity}</span></td>
                <td><span className="text-muted">{log.service}</span></td>
                <td style={{ maxWidth: '400px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.message}>
                  {log.message}
                </td>
                <td>{userCell(log)}</td>
                <td className="text-muted text-xs">{log.traceId || '-'}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No logs found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const UsersPage = () => {
  const [searchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') ?? '';
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState(urlSearch);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">User Operations</h1>
        <div className="flex gap-4">
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
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>WhatsApp ID</th>
              <th>Profile Name</th>
              <th>Type</th>
              <th>Created At</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center' }}>Loading...</td></tr>
            ) : Array.isArray(users) && users.length > 0 ? users.map(user => (
              <tr key={user.id} className="text-sm">
                <td className="text-muted text-xs font-mono">{user.id}</td>
                <td>{user.whatsappId}</td>
                <td className="font-medium">{user.profileName || 'Unknown'}</td>
                <td><span className="badge badge-secondary">{user.isGuest ? 'Guest' : 'User'}</span></td>
                <td className="text-muted">{new Date(user.createdAt).toLocaleDateString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => handleDelete(user.id)} className="text-error" style={{ color: 'var(--color-error)', padding: '4px' }}>
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SettingsPage = () => (
  <div className="p-6">
    <h1 className="text-2xl font-bold mb-6">Admin Settings</h1>
    <div className="card" style={{ maxWidth: '600px' }}>
      <div className="mb-4">
        <label className="text-sm font-medium text-muted block mb-1">API Base URL</label>
        <input type="text" className="input" value="https://api.broadwaylive.in" readOnly />
      </div>
      <div className="mb-4">
        <label className="text-sm font-medium text-muted block mb-1">Environment</label>
        <p className="font-semibold flex items-center gap-2">
          Production <span className="badge badge-error">Live</span>
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
        </Routes>
      </main>
    </div>
  );
};

export default App;
