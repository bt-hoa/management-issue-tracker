import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, User } from './types';
import { getUser } from './auth';
import { sendWeeklyDigest } from './email';
import { checkOverdue } from './jobs/overdue-check';
import { syncResidentRoster, syncAutoDetails } from './google/sheets';
import tasksRouter from './routes/tasks';
import tagsRouter from './routes/tags';
import usersRouter from './routes/users';
import residentsRouter from './routes/residents';
import attachmentsRouter from './routes/attachments';
import adminRouter from './routes/admin';

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();

app.use('*', cors());

// Auth middleware — runs before all API routes
app.use('/api/*', async (c, next) => {
  const user = await getUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!user.active) return c.json({ error: 'Account disabled' }, 403);
  c.set('user', user);
  await next();
});

app.get('/api/me', (c) => c.json(c.get('user')));

// Serve frontend assets for all non-API routes
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.route('/api/tasks',     tasksRouter);
app.route('/api/tags',      tagsRouter);
app.route('/api/users',     usersRouter);
app.route('/api/residents', residentsRouter);
app.route('/api',           attachmentsRouter);
app.route('/api',           adminRouter);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 8 * * 5') {
      await sendWeeklyDigest(env);
    } else if (event.cron === '0 6 * * *') {
      await Promise.all([
        checkOverdue(env),
        syncResidentRoster(env),
        syncAutoDetails(env),
      ]);
    }
  },
};
