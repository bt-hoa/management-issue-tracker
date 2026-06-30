import { api } from '../api';
import { store } from '../store';

export class NewTaskView {
  constructor(private container: HTMLElement) {}

  render() {
    const { tags, users } = store.getState();

    this.container.innerHTML = `
      <div style="max-width:600px">
        <h2 style="font-size:1.1rem;font-weight:600;margin-bottom:16px">New Task</h2>
        <div class="card">
          <div class="field-group">
            <label class="field-label">Title *</label>
            <input type="text" class="input" id="new-title" placeholder="What needs to be done?">
          </div>
          <div class="field-group">
            <label class="field-label">Description</label>
            <textarea class="input" id="new-desc" rows="3" placeholder="Details, context, links..."></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field-group">
              <label class="field-label">Priority</label>
              <select class="input" id="new-priority">
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Group</label>
              <select class="input" id="new-group">
                <option value="management">Management</option>
                <option value="board">Board</option>
                <option value="vendor">Vendor</option>
                <option value="joint">Joint</option>
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Owner</label>
              <select class="input" id="new-owner">
                <option value="">— Unassigned —</option>
                ${users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Due Date</label>
              <input type="date" class="input" id="new-due">
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">Tags</label>
            <div id="tag-selector" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
              ${tags.map(t => `
                <label style="cursor:pointer;display:flex;align-items:center;gap:4px">
                  <input type="checkbox" value="${t.id}" data-color="${t.color}">
                  <span class="tag-chip" style="background:${t.color}">${t.name}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn btn-primary" id="create-btn">Create Task</button>
            <a href="#/" class="btn btn-secondary">Cancel</a>
          </div>
          <div id="create-error" style="color:#ef4444;font-size:0.8rem;margin-top:8px"></div>
        </div>
      </div>
    `;

    document.getElementById('create-btn')?.addEventListener('click', async () => {
      const title = (document.getElementById('new-title') as HTMLInputElement).value.trim();
      if (!title) {
        (document.getElementById('create-error')!).textContent = 'Title is required.';
        return;
      }
      const tagIds = [...document.querySelectorAll<HTMLInputElement>('#tag-selector input:checked')]
        .map(el => el.value);

      try {
        const task = await api.tasks.create({
          title,
          description: (document.getElementById('new-desc') as HTMLTextAreaElement).value || undefined,
          priority: (document.getElementById('new-priority') as HTMLSelectElement).value as never,
          responsibility_group: (document.getElementById('new-group') as HTMLSelectElement).value as never,
          owner_id: (document.getElementById('new-owner') as HTMLSelectElement).value || undefined,
          due_date: (document.getElementById('new-due') as HTMLInputElement).value || undefined,
          tags: tagIds.map(id => store.getState().tags.find(t => t.id === id)!).filter(Boolean),
        });
        location.hash = `#/tasks/${task.id}`;
      } catch (e) {
        (document.getElementById('create-error')!).textContent = String(e);
      }
    });
  }
}
