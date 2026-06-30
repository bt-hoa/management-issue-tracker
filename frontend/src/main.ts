import { api } from './api';
import { store } from './store';
import { TaskListView } from './views/TaskList';
import { TaskDetailView } from './views/TaskDetail';
import { NewTaskView } from './views/NewTask';
import { ArchiveView } from './views/Archive';
import { SettingsView } from './views/Settings';

const app = document.getElementById('app')!;

function buildShell(): { sidebar: HTMLElement; content: HTMLElement } {
  app.innerHTML = `
    <nav class="sidebar">
      <div class="sidebar-logo">Bellaire Tower<br>HOA Tracker</div>
      <div class="sidebar-nav">
        <a href="#/" data-route="/">&#9632; All Tasks</a>
        <a href="#/tasks/new" data-route="/tasks/new">+ New Task</a>
        <a href="#/archive" data-route="/archive">&#128449; Archive</a>
        <a href="#/settings" data-route="/settings">&#9881; Settings</a>
      </div>
    </nav>
    <div class="main">
      <div id="view-content" class="content"></div>
    </div>
  `;

  const sidebar = app.querySelector('.sidebar') as HTMLElement;
  const content = app.querySelector('#view-content') as HTMLElement;
  return { sidebar, content };
}

function setActiveNav(route: string) {
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', (a as HTMLAnchorElement).dataset.route === route);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentView: any = null;

async function route() {
  const hash = location.hash.replace('#', '') || '/';
  if (currentView?.destroy) currentView.destroy();

  const { content } = document.querySelector('.main')
    ? { content: document.querySelector('#view-content') as HTMLElement }
    : buildShell();

  content.innerHTML = '';

  const taskMatch = hash.match(/^\/tasks\/(\d+)$/);
  const isNew = hash === '/tasks/new';

  if (isNew) {
    setActiveNav('/tasks/new');
    const view = new NewTaskView(content);
    currentView = view;
    view.render();
  } else if (taskMatch) {
    setActiveNav('/');
    const view = new TaskDetailView(content, parseInt(taskMatch[1]));
    currentView = view;
    await view.render();
  } else if (hash === '/archive') {
    setActiveNav('/archive');
    const view = new ArchiveView(content);
    currentView = view;
    await view.render();
  } else if (hash === '/settings') {
    setActiveNav('/settings');
    const view = new SettingsView(content);
    currentView = view;
    await view.render();
  } else {
    setActiveNav('/');
    const view = new TaskListView(content);
    currentView = view;
    await view.render();
  }
}

async function init() {
  buildShell();
  try {
    const [user, tags, users] = await Promise.all([
      api.me(),
      api.tags.list(),
      api.users.list().catch(() => []),
    ]);
    store.set('currentUser', user);
    store.set('tags', tags);
    store.set('users', users);
  } catch (e) {
    console.error('Failed to load user info', e);
  }

  window.addEventListener('hashchange', route);
  await route();
}

init();
