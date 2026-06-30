import { api, type Task } from '../api';
import { store } from '../store';

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export class TaskDetailView {
  private task: Task | null = null;

  constructor(private container: HTMLElement, private taskId: number) {}

  async render() {
    this.container.innerHTML = `<div class="spinner" style="margin:60px auto;display:block"></div>`;
    try {
      this.task = await api.tasks.get(this.taskId);
      this.renderTask();
    } catch {
      this.container.innerHTML = `<div class="empty-state"><h3>Task not found</h3></div>`;
    }
  }

  private renderTask() {
    const t = this.task!;
    const user = store.getState().currentUser;
    const canWriteDirection = user?.role === 'admin' || user?.role === 'board';
    const canArchive = user?.role === 'admin' || user?.role === 'board';

    this.container.innerHTML = `
      <div style="margin-bottom:12px">
        <a href="#/" style="color:#6b7280;font-size:0.8rem">← All Tasks</a>
      </div>
      <div class="task-detail-layout">
        <div>
          <h1 style="font-size:1.25rem;font-weight:600;margin-bottom:12px">
            <span style="font-family:var(--font-mono);color:#6b7280;font-size:0.75rem">#${t.id}</span>
            &nbsp;${t.title}
          </h1>

          ${t.description ? `<p style="color:#374151;margin-bottom:16px;line-height:1.6">${t.description}</p>` : ''}

          ${t.awaiting_board ? `
            <div class="awaiting-banner">
              ⚠ <strong>Awaiting Board</strong>${t.awaiting_board_text ? ' — ' + t.awaiting_board_text : ''}
            </div>` : ''}

          ${t.board_direction ? `
            <div class="direction-panel">
              ✓ <strong>Board Direction</strong> (${fmt(t.board_direction_date)})
              — ${t.board_direction}
            </div>` : ''}

          ${canWriteDirection && !t.board_direction ? `
            <div class="card" style="margin-bottom:16px" id="direction-form">
              <div class="field-group">
                <label class="field-label">Record Board Direction</label>
                <textarea id="direction-text" class="input" rows="3" placeholder="Enter the board's direction or decision..."></textarea>
              </div>
              <button class="btn btn-primary" id="save-direction">Save Direction</button>
            </div>` : ''}

          <div class="card" id="comments-section">
            <div style="font-weight:600;margin-bottom:12px">Activity</div>
            <div id="comment-list">
              ${(t.comments ?? []).map(c => `
                <div class="comment">
                  <div class="comment-avatar">${(c.user_name ?? 'S')[0].toUpperCase()}</div>
                  <div class="comment-body">
                    <div class="comment-meta">${c.user_name ?? 'System'} · ${fmt(c.created_at)}</div>
                    <div class="${c.is_system ? 'comment-system' : ''}">${c.content}</div>
                  </div>
                </div>
              `).join('')}
            </div>
            <div style="margin-top:12px;display:flex;gap:8px">
              <textarea id="comment-input" class="input" rows="2" placeholder="Add a comment..." style="flex:1"></textarea>
              <button class="btn btn-primary" id="add-comment" style="align-self:flex-end">Post</button>
            </div>
          </div>
        </div>

        <div>
          <div class="card" style="margin-bottom:12px">
            <div class="field-group">
              <label class="field-label">Status</label>
              <select class="input" id="field-status">
                ${['not_started','in_progress','blocked','complete'].map(s =>
                  `<option value="${s}"${t.status === s ? ' selected' : ''}>${s.replace('_',' ')}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Priority</label>
              <select class="input" id="field-priority">
                ${['urgent','high','normal','low'].map(p =>
                  `<option value="${p}"${t.priority === p ? ' selected' : ''}>${p}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Group</label>
              <select class="input" id="field-group">
                ${['board','management','vendor','joint','individual'].map(g =>
                  `<option value="${g}"${t.responsibility_group === g ? ' selected' : ''}>${g}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Due Date</label>
              <input type="date" class="input" id="field-due" value="${t.due_date ?? ''}">
            </div>
            <div class="field-group">
              <label class="field-label">Awaiting Board</label>
              <input type="checkbox" id="field-awaiting" ${t.awaiting_board ? 'checked' : ''}>
            </div>
            ${t.awaiting_board ? `
              <div class="field-group">
                <label class="field-label">Awaiting Board Text</label>
                <input type="text" class="input" id="field-awaiting-text" value="${t.awaiting_board_text ?? ''}">
              </div>` : ''}
            <button class="btn btn-secondary" id="save-fields" style="width:100%;margin-top:4px">Save Changes</button>
          </div>

          <div class="card" style="margin-bottom:12px">
            <div style="font-size:0.75rem;color:#6b7280;margin-bottom:6px">Tags</div>
            <div>${t.tags.map(g => `<span class="tag-chip" style="background:${g.color};margin:2px">${g.name}</span>`).join('')}</div>
          </div>

          <div class="card" style="margin-bottom:12px">
            <div style="font-size:0.75rem;color:#6b7280;margin-bottom:6px">Attachments</div>
            ${(t.attachments ?? []).map(a =>
              a.source === 'r2'
                ? `<div><a href="/api/${a.id}/download" target="_blank">&#128206; ${a.filename}</a></div>`
                : `<div><a href="${a.drive_web_view_link}" target="_blank" rel="noopener">&#128449; ${a.filename} <span style="color:#6b7280">Drive ↗</span></a></div>`
            ).join('') || '<div style="color:#6b7280;font-size:0.75rem">None</div>'}
            <div style="margin-top:8px;display:flex;gap:6px">
              <label class="btn btn-secondary" style="cursor:pointer">
                &#128206; Upload <input type="file" id="file-upload" style="display:none">
              </label>
            </div>
          </div>

          ${canArchive && !t.archived_at ? `
            <button class="btn btn-danger" id="archive-btn" style="width:100%">Archive Task</button>` : ''}
          ${t.archived_at ? `
            <button class="btn btn-secondary" id="restore-btn" style="width:100%">Restore from Archive</button>` : ''}

          <div style="font-size:0.7rem;color:#9ca3af;margin-top:12px">
            Created ${fmt(t.created_at)}<br>Updated ${fmt(t.updated_at)}
          </div>
        </div>
      </div>
    `;

    this.attachListeners();
  }

  private attachListeners() {
    const t = this.task!;

    document.getElementById('save-fields')?.addEventListener('click', async () => {
      const status   = (document.getElementById('field-status') as HTMLSelectElement).value;
      const priority = (document.getElementById('field-priority') as HTMLSelectElement).value;
      const group    = (document.getElementById('field-group') as HTMLSelectElement).value;
      const due_date = (document.getElementById('field-due') as HTMLInputElement).value || null;
      const awaiting = (document.getElementById('field-awaiting') as HTMLInputElement)?.checked;
      const awaitingText = (document.getElementById('field-awaiting-text') as HTMLInputElement)?.value;

      await api.tasks.update(t.id, {
        status: status as never, priority: priority as never,
        responsibility_group: group as never,
        due_date,
        awaiting_board: awaiting,
        awaiting_board_text: awaitingText || null,
      });
      await this.render();
    });

    document.getElementById('save-direction')?.addEventListener('click', async () => {
      const text = (document.getElementById('direction-text') as HTMLTextAreaElement).value.trim();
      if (!text) return;
      await api.tasks.update(t.id, { board_direction: text });
      await this.render();
    });

    document.getElementById('add-comment')?.addEventListener('click', async () => {
      const input = document.getElementById('comment-input') as HTMLTextAreaElement;
      const text = input.value.trim();
      if (!text) return;
      await api.tasks.comment(t.id, text);
      input.value = '';
      await this.render();
    });

    document.getElementById('archive-btn')?.addEventListener('click', async () => {
      if (!confirm('Archive this task?')) return;
      await api.tasks.archive(t.id);
      location.hash = '#/';
    });

    document.getElementById('restore-btn')?.addEventListener('click', async () => {
      await api.tasks.restore(t.id);
      location.hash = '#/';
    });

    document.getElementById('file-upload')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      await fetch(`/api/tasks/${t.id}/attachments`, { method: 'POST', body: fd });
      await this.render();
    });
  }
}
