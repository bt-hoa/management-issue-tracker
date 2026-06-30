import { api } from '../api';
import { store } from '../store';

export class SettingsView {
  constructor(private container: HTMLElement) {}

  async render() {
    const user = store.getState().currentUser;
    const isAdmin = user?.role === 'admin';
    const isAdminOrBoard = user?.role === 'admin' || user?.role === 'board';

    const [syncStatus, users, tags] = await Promise.all([
      isAdmin ? api.residents.status() : Promise.resolve(null),
      isAdminOrBoard ? api.users.list() : Promise.resolve([]),
      api.tags.list(),
    ]);

    this.container.innerHTML = `
      <h2 style="font-size:1.1rem;font-weight:600;margin-bottom:16px">Settings</h2>

      ${isAdminOrBoard ? `
      <div class="card" style="margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:12px">Export</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" id="export-sheets">Export to Google Sheets</button>
          <a href="/api/export/csv" class="btn btn-secondary" download>Download CSV</a>
        </div>
        <div id="export-status" style="margin-top:8px;font-size:0.8rem;color:#6b7280"></div>
      </div>` : ''}

      ${isAdmin ? `
      <div class="card" style="margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:12px">Residents & Vehicles</div>
        <div style="font-size:0.8rem;color:#6b7280;margin-bottom:8px">
          ${syncStatus ? `${syncStatus.residents} residents · ${syncStatus.vehicles} vehicles · Last sync: ${syncStatus.last_synced_at ?? 'Never'}` : ''}
        </div>
        <button class="btn btn-secondary" id="sync-residents">Sync Now</button>
        <div id="sync-status" style="margin-top:8px;font-size:0.8rem;color:#6b7280"></div>
      </div>` : ''}

      ${isAdmin ? `
      <div class="card" style="margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:12px">Users</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.8rem">
          <thead><tr style="border-bottom:1px solid var(--color-border)">
            <th style="text-align:left;padding:4px 8px">Name</th>
            <th style="text-align:left;padding:4px 8px">Email</th>
            <th style="text-align:left;padding:4px 8px">Role</th>
            <th style="text-align:left;padding:4px 8px">Active</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr style="border-bottom:1px solid var(--color-border)">
                <td style="padding:6px 8px">${u.name}</td>
                <td style="padding:6px 8px">${u.email}</td>
                <td style="padding:6px 8px">
                  <select class="input" data-user-role="${u.id}" style="padding:2px 6px">
                    ${['admin','board','management','vendor','resident'].map(r =>
                      `<option value="${r}"${u.role === r ? ' selected' : ''}>${r}</option>`
                    ).join('')}
                  </select>
                </td>
                <td style="padding:6px 8px">
                  <input type="checkbox" data-user-active="${u.id}" ${u.active ? 'checked' : ''}>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top:12px">
          <button class="btn btn-secondary" id="invite-btn">+ Invite User</button>
        </div>
        <div id="invite-form" style="display:none;margin-top:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
            <input type="text" class="input" id="inv-name" placeholder="Name">
            <input type="email" class="input" id="inv-email" placeholder="Email">
            <select class="input" id="inv-role">
              ${['board','management','vendor'].map(r => `<option value="${r}">${r}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" id="send-invite">Send Invite</button>
        </div>
      </div>` : ''}

      <div class="card" style="margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:12px">Tags</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${tags.map(t => `<span class="tag-chip" style="background:${t.color}">${t.name}</span>`).join('')}
        </div>
        ${isAdminOrBoard ? `
        <div style="display:flex;gap:8px">
          <input type="text" class="input" id="new-tag-name" placeholder="Tag name" style="max-width:160px">
          <input type="color" id="new-tag-color" value="#6366f1" style="width:40px;height:36px;border:1px solid var(--color-border);border-radius:4px;cursor:pointer">
          <button class="btn btn-secondary" id="create-tag">Add Tag</button>
        </div>` : ''}
      </div>
    `;

    document.getElementById('export-sheets')?.addEventListener('click', async () => {
      const status = document.getElementById('export-status')!;
      status.textContent = 'Creating sheet…';
      try {
        const { url } = await api.export.sheets();
        status.innerHTML = `<a href="${url}" target="_blank" rel="noopener">Open Sheet ↗</a>`;
      } catch (e) {
        status.textContent = `Error: ${e}`;
      }
    });

    document.getElementById('sync-residents')?.addEventListener('click', async () => {
      const status = document.getElementById('sync-status')!;
      status.textContent = 'Syncing…';
      try {
        const r = await api.residents.sync();
        status.textContent = `Done — roster: +${(r.roster as {inserted:number}).inserted} updated ${(r.roster as {updated:number}).updated}`;
      } catch (e) {
        status.textContent = `Error: ${e}`;
      }
    });

    document.getElementById('invite-btn')?.addEventListener('click', () => {
      const form = document.getElementById('invite-form')!;
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('send-invite')?.addEventListener('click', async () => {
      const name  = (document.getElementById('inv-name') as HTMLInputElement).value.trim();
      const email = (document.getElementById('inv-email') as HTMLInputElement).value.trim();
      const role  = (document.getElementById('inv-role') as HTMLSelectElement).value;
      if (!name || !email) return;
      await api.users.invite(email, name, role);
      await this.render();
    });

    document.getElementById('create-tag')?.addEventListener('click', async () => {
      const name  = (document.getElementById('new-tag-name') as HTMLInputElement).value.trim();
      const color = (document.getElementById('new-tag-color') as HTMLInputElement).value;
      if (!name) return;
      await api.tags.create(name, color);
      await this.render();
    });

    // Role changes
    document.querySelectorAll<HTMLSelectElement>('[data-user-role]').forEach(sel => {
      sel.addEventListener('change', () => {
        api.users.update(sel.dataset.userRole!, { role: sel.value as never });
      });
    });

    // Active toggle
    document.querySelectorAll<HTMLInputElement>('[data-user-active]').forEach(cb => {
      cb.addEventListener('change', () => {
        api.users.update(cb.dataset.userActive!, { active: cb.checked });
      });
    });
  }
}
