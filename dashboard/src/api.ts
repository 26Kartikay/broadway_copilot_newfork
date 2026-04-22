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
  /** Nullable in DB; set via bulk CSV `gender` / admin. */
  confirmedGender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  /** Nullable in DB; Prisma `AgeGroup` (TEEN | ADULT | SENIOR). */
  confirmedAgeGroup?: 'TEEN' | 'ADULT' | 'SENIOR' | null;
}

export type LogQuery = {
  severity?: string;
  service?: string;
  userId?: string;
  search?: string;
  limit?: string;
  offset?: string;
};

export type AdminConfig = {
  chatApiUrl: string;
  nodeEnv: string;
};

export const api = {
  getConfig: async (): Promise<AdminConfig> => {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) return { chatApiUrl: '', nodeEnv: 'production' };
    return res.json();
  },
  getHealth: async () => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
  getLogs: async (filters: LogQuery) => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== '') params.set(k, v);
      });
      const q = params.toString();
      const res = await fetch(`${API_BASE}/logs${q ? `?${q}` : ''}`);
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
  bulkCreateUsers: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/users/bulk`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(typeof data?.message === 'string' ? data.message : data?.error || res.statusText);
    }
    return data as {
      total: number;
      succeeded: number;
      created: number;
      errors: number;
      details: { user: string; error: string }[];
    };
  },
  deleteUser: async (id: string) => {
    const res = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
    return res.json();
  },
};
