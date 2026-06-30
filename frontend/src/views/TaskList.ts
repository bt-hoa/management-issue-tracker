import { api, type Task } from '../api';
import { store } from '../store';

const SORT_MODES = [
  { key: 'smart',    label: 'Smart' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'updated',  label: 'Updated' },
  { key: 'group',    label: 'Group' },
];

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started', in_progress: 'In Progress',
  overdue: 'Overdue', blocked: 'Blocked', complete: 'Complete',
};

function priorityDot(p: string) {
  return `<span class="priority-dot priority-dot-${p}" title="${p}"></span>`;
}

function statusBadge(s: string) {
  return `<span class="badge badge-${s}">${STATUS_LABEL[s] ?? s}</span>`;
}

function taskRowHtml(t: Task): string {
  const awaitingClass = t.awaiting_board ? ' awaiting' : '';
  const overdueClass  = t.status === 'overdue' ? ' overdue' : '';
  const tags = t.tags.slice(0, 3).map(g =>
    `<span class="tag-chip" style="background:${g.color}">${g.name}</span>`
  ).join(' ');

  const awaitingLine = t.awaiting_board
    ? `<div class="task-row-alerts">⚠ Awaiting Board${t.awaiting_board_text ? ': ' + t.awaiting_board_text.slice(0, 60) : ''}
       ${t.comment_count > 0 ? `&nbsp;&#128172; ${t.comment_count}` : ''}</div>`
    : '';

  return `
    <div class="task-row${awaitingClass}${overdueClass}" data-id="${t.id}">
      ${priorityDot(t.priority)}
      <div class="task-row-body">
        <div class="task-row-title">
          <span class="mono" style="color:#6b7280;font-size:0.7rem">#${t.id}</span>
          &nbsp;${t.title}
        </div>
        <div class="task-row-meta">
          <span>${t.responsibility_group}</span>
          ${t.owner_name ? `<span>· ${t.owner_name}</span>` : ''}
          ${t.due_date ? `<span>· ${t.due_date}</span>` : ''}
          ${tags}
        </div>
        ${awaitingLine}
      </div>
      ${statusBadge(t.status)}
    </div>
  `;
}

export class TaskListView {
  private tasks: Task[] = [];
  private unsub: (() => void) | null = null;

  constructor(private container: HTMLElement) {}

  async render() {
    this.container.innerHTML = `
      <div class="sort-bar" id="sort-bar"></div>
      <div id="task-list-items" style="padding-top:8px;"></div>
    `;
    this.renderSortBar();
    await this.loadTasks();

    this.unsub = store.subscribe(() => this.renderList());

    this.container.addEventListener('click', e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.task-row');
      if (row?.dataset.id) location.hash = `#/tasks/${row.dataset.id}`;
    });
  }

  private renderSortBar() {
    const { sortMode } = store.getState();
    const bar = document.getElementById('sort-bar')!;
    bar.innerHTML = SORT_MODES.map(m =>
      `<button class="sort-btn${sortMode === m.key ? ' active' : ''}" data-sort="${m.key}">${m.label}</button>`
    ).join('');
    bar.addEventListener('click', async e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sort]');
      if (!btn) return;
      store.set('sortMode', btn.dataset.sort as never);
      this.renderSortBar();
      await this.loadTasks();
    });
  }

  private async loadTasks() {
    const list = document.getElementById('task-list-items');
    if (list) list.innerHTML = '<div style="padding:20px;text-align:center"><div class="spinner" style="margin:auto"></div></div>';
    try {
      this.tasks = await api.tasks.list(store.buildQueryString());
      store.set('tasks', this.tasks);
      this.renderList();
    } catch (e) {
      if (list) list.innerHTML = `<div class="empty-state"><p>Failed to load tasks.</p></div>`;
    }
  }

  private renderList() {
    const list = document.getElementById('task-list-items');
    if (!list) return;
    if (!this.tasks.length) {
      list.innerHTML = '<div class="empty-state"><h3>No tasks</h3><p>Create a task to get started.</p></div>';
      return;
    }
    list.innerHTML = this.tasks.map(taskRowHtml).join('');
  }

  destroy() { this.unsub?.(); }
}
