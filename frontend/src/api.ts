import type { Task, User, Tag, Resident } from '../../src/types';

export type { Task, User, Tag, Resident };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: ()                      => request<User>('/me'),
  dashboard: ()               => request<Record<string, number>>('/dashboard'),

  tasks: {
    list:         (params = '')    => request<Task[]>(`/tasks${params ? '?' + params : ''}`),
    listArchive:  (q = '')         => request<Task[]>(`/tasks/archive${q ? '?q=' + encodeURIComponent(q) : ''}`),
    get:          (id: number)     => request<Task>(`/tasks/${id}`),
    create:       (body: Partial<Task>) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
    update:       (id: number, body: Partial<Task> & { tag_ids?: string[] }) =>
      request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    archive:      (id: number)     => request<{ ok: boolean }>(`/tasks/${id}/archive`, { method: 'DELETE' }),
    restore:      (id: number)     => request<Task>(`/tasks/${id}/restore`, { method: 'POST' }),
    subscribe:    (id: number)     => request<{ ok: boolean }>(`/tasks/${id}/subscribe`, { method: 'POST' }),
    unsubscribe:  (id: number)     => request<{ ok: boolean }>(`/tasks/${id}/subscribe`, { method: 'DELETE' }),
    comment:      (id: number, content: string) =>
      request<{ id: string }>(`/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),
    approve:      (id: number, vote: 'approve' | 'decline', note?: string) =>
      request<{ ok: boolean }>(`/tasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ vote, note }) }),
  },

  tags: {
    list:   ()                             => request<Tag[]>('/tags'),
    create: (name: string, color: string)  => request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
    delete: (id: string)                   => request<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
  },

  users: {
    list:   ()                                           => request<User[]>('/users'),
    invite: (email: string, name: string, role: string) =>
      request<User>('/users/invite', { method: 'POST', body: JSON.stringify({ email, name, role }) }),
    update: (id: string, body: Partial<User>)            =>
      request<{ ok: boolean }>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  residents: {
    list:   (params = '')  => request<Resident[]>(`/residents${params ? '?' + params : ''}`),
    get:    (id: string)   => request<Resident>(`/residents/${id}`),
    sync:   ()             => request<{ roster: object; auto_details: object; synced_at: string }>('/residents/sync', { method: 'POST' }),
    status: ()             => request<{ residents: number; vehicles: number; last_synced_at: string | null }>('/residents/sync/status'),
  },

  export: {
    sheets: (includeArchived = false) =>
      request<{ url: string }>(`/export/sheets${includeArchived ? '?include=archived' : ''}`),
    csv: () => fetch('/api/export/csv'),
  },
};
