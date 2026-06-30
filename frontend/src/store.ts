import type { Task, User, Tag } from './api';

export interface FilterState {
  status: string[];
  priority: string[];
  group: string[];
  owner: string;
  tag: string;
  awaitingOnly: boolean;
  myTasksOnly: boolean;
}

export type SortMode = 'smart' | 'due_date' | 'priority' | 'updated' | 'group' | 'owner';

interface AppState {
  currentUser: User | null;
  tasks: Task[];
  tags: Tag[];
  users: User[];
  filters: FilterState;
  sortMode: SortMode;
  isLoading: boolean;
  error: string | null;
}

type Listener = () => void;

const defaultFilters: FilterState = {
  status: [], priority: [], group: [], owner: '', tag: '',
  awaitingOnly: false, myTasksOnly: false,
};

class Store {
  private state: AppState = {
    currentUser: null, tasks: [], tags: [], users: [],
    filters: { ...defaultFilters }, sortMode: 'smart',
    isLoading: false, error: null,
  };

  private listeners: Set<Listener> = new Set();

  getState(): Readonly<AppState> { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() { this.listeners.forEach(fn => fn()); }

  set<K extends keyof AppState>(key: K, value: AppState[K]) {
    this.state = { ...this.state, [key]: value };
    this.notify();
  }

  setFilters(patch: Partial<FilterState>) {
    this.state = { ...this.state, filters: { ...this.state.filters, ...patch } };
    this.notify();
  }

  buildQueryString(): string {
    const { filters, sortMode } = this.state;
    const params = new URLSearchParams();
    if (filters.status.length === 1)  params.set('status',   filters.status[0]);
    if (filters.priority.length === 1) params.set('priority', filters.priority[0]);
    if (filters.group.length === 1)    params.set('group',    filters.group[0]);
    if (filters.owner)                 params.set('owner',    filters.owner);
    if (filters.tag)                   params.set('tag',      filters.tag);
    if (filters.awaitingOnly)          params.set('awaiting', '1');
    params.set('sort', sortMode);
    return params.toString();
  }
}

export const store = new Store();
