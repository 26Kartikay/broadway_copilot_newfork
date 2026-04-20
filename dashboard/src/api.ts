const API_BASE = '/admin';

export interface ServiceLog {
  id: string;
  createdAt: string;
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'DEFAULT';
  service: string;
  message: string;
  context: any;
  userId?: string;
  appUserId?: string;
  whatsappId?: string;
  profileNameSnapshot?: string;
  user?: {
    id: string;
    profileName: string;
  };
  conversationId?: string;
  graphRunId?: string;
  traceId?: string;
}

export interface User {
  id: string;
  appUserId: string;
  whatsappId: string;
  profileName: string;
  isGuest: boolean;
  createdAt: string;
}

export const api = {
  getHealth: async () => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
  getLogs: async (filters: any) => {
    try {
      const params = new URLSearchParams(filters);
      const res = await fetch(`${API_BASE}/logs?${params}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('Fetch logs error:', e);
      return [];
    }
  },
  getUsers: async (search?: string) => {
    try {
      const res = await fetch(`${API_BASE}/users${search ? `?search=${search}` : ''}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('Fetch users error:', e);
      return [];
    }
  },
  createUser: async (user: Partial<User>) => {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    return res.json();
  },
  deleteUser: async (id: string) => {
    const res = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
    return res.json();
  },
};
