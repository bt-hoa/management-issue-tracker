import { api, type Task } from '../api';

export class ArchiveView {
  constructor(private container: HTMLElement) {}

  async render() {
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <h2 style="font-size:1.1rem;font-weight:600">Archive</h2>
        <input type="search" class="search-input" id="archive-search" placeholder="Search archived tasks...">
      </div>
      <div id="archive-list"></div>
    `;

    const search = document.getElementById('archive-search') as HTMLInputElement;
    let timer: ReturnType<typeof setTimeout>;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.load(search.value), 300);
    });

    await this.load('');
  }

  private async load(q: string) {
    const list = document.getElementById('archive-list')!;
    list.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner" style="margin:auto"></div></div>';
    const tasks: Task[] = await api.tasks.listArchive(q);
    if (!tasks.length) {
      list.innerHTML = '<div class="empty-state"><h3>No archived tasks</h3></div>';
      return;
    }
    list.innerHTML = tasks.map((t: Task) => `
      <div class="task-row" style="cursor:pointer" onclick="location.hash='#/tasks/${t.id}'">
        <div class="task-row-body">
          <div class="task-row-title">
            <span class="mono" style="color:#6b7280;font-size:0.7rem">#${t.id}</span> ${t.title}
          </div>
          <div class="task-row-meta">
            <span>${t.status}</span> · <span>archived ${t.archived_at?.split('T')[0] ?? ''}</span>
            ${t.tags.map(g => `<span class="tag-chip" style="background:${g.color}">${g.name}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }
}
