import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import request from 'supertest';
import { createRetrainingRouter, WORKER_OFFLINE_MESSAGE } from '../src/services/retraining_proxy';

interface Seen { method: string; url: string; body: Record<string, unknown> }
interface FakeWorker { url: string; seen: Seen[]; close: () => Promise<void> }

function startFakeWorker(reply: (seen: Seen) => { status: number; body: unknown }): Promise<FakeWorker> {
  const seen: Seen[] = [];
  const app = express();
  app.use(express.json());
  app.use((req: Request, res: Response) => {
    const entry = { method: req.method, url: req.originalUrl, body: (req.body ?? {}) as Record<string, unknown> };
    seen.push(entry);
    const { status, body } = reply(entry);
    res.status(status).json(body);
  });
  const server = http.createServer(app);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => new Promise(done => server.close(() => done())) });
    });
  });
}

function closedPortUrl(): Promise<string> {
  return new Promise(resolve => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}

function appWith(workerUrl: string, role = 'user') {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: { _id: string; username: string; role: string } }).user = { _id: `u-${role}`, username: `dr-${role}`, role };
    next();
  });
  const guard = (req: Request, res: Response, next: NextFunction): void => {   // behaves like isAuthAndNotGuest
    if ((req as unknown as { user: { role: string } }).user.role === 'guest') {
      res.status(403).json({ message: 'Forbidden. Admin or regular user access required.' });
      return;
    }
    next();
  };
  app.use('/retraining', createRetrainingRouter({ guard, workerUrl, timeoutMs: 2000 }));
  return app;
}

const ok = () => ({ status: 200, body: { ok: true, data: {} } });
const chosen = ['a'.repeat(24)];

describe('Extend Training proxy (plan WS13)', () => {
  let worker: FakeWorker | null = null;
  afterEach(async () => {
    if (worker) await worker.close();
    worker = null;
  });

  it('wraps the worker reply in { success, message, data }', async () => {
    worker = await startFakeWorker(() => ({ status: 200, body: { ok: true, data: { busy: false } } }));
    const res = await request(appWith(worker.url)).get('/retraining/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'OK', data: { busy: false } });
    expect(worker.seen[0]).toMatchObject({ method: 'GET', url: '/status?owner=u-user' });
  });

  it('names the session user, never whoever the request body claims to be', async () => {
    worker = await startFakeWorker(ok);
    await request(appWith(worker.url)).post('/retraining/start')
      .send({ requestedBy: 'someone-else', requestedById: 'someone-else', selection: chosen });
    expect(worker.seen[0]).toMatchObject({ method: 'POST', url: '/jobs/train',
      body: { requestedBy: 'dr-user', requestedById: 'u-user', selection: chosen } });
  });

  it("passes the worker's refusal through with its reason", async () => {
    worker = await startFakeWorker(() => ({ status: 409, body: { ok: false, error: 'A training is already running (started by dr-lee).' } }));
    const res = await request(appWith(worker.url)).post('/retraining/start').send({ selection: chosen });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('dr-lee');
  });

  it('answers 503 with a plain reason when the worker is not running', async () => {
    const res = await request(appWith(await closedPortUrl())).get('/retraining/status');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: WORKER_OFFLINE_MESSAGE, data: { workerOnline: false } });
  });

  it('refuses a malformed label, job id or confirmation without calling the worker', async () => {
    worker = await startFakeWorker(ok);
    const app = appWith(worker.url);
    expect((await request(app).post('/retraining/versions/..%2Fregistry/activate').send({ confirm: [] })).status).toBe(400);
    expect((await request(app).post('/retraining/versions/unet-ui0925-120000/activate').send({})).status).toBe(400);
    expect((await request(app).post('/retraining/versions/unet-ui0925-120000/reject').send({ confirm: [1] })).status).toBe(400);
    expect((await request(app).get('/retraining/job/not-a-job/log')).status).toBe(400);
    expect((await request(app).get('/retraining/versions/unet-ui0925-120000/examples/x')).status).toBe(400);
    expect((await request(app).get('/retraining/versions/..%2Fregistry/results')).status).toBe(400);
    for (const selection of [undefined, [], ['../registry'], [{ $ne: null }]]) {
      expect((await request(app).post('/retraining/start').send({ selection })).status).toBe(400);
    }
    expect(worker.seen).toHaveLength(0);
  });

  it('forwards a confirmed activation with exactly the lines the user saw', async () => {
    worker = await startFakeWorker(() => ({ status: 200, body: { ok: true, data: { active: 'unet-ui0925-120000' } } }));
    const lines = ['public acdc: lower score than unet-2026-05-01'];
    const res = await request(appWith(worker.url)).post('/retraining/versions/unet-ui0925-120000/activate').send({ confirm: lines });
    expect(res.status).toBe(200);
    expect(worker.seen[0]).toMatchObject({ url: '/versions/unet-ui0925-120000/activate', body: { confirm: lines, requestedBy: 'dr-user' } });
  });

  it('clamps the log tail and passes only a known preview action', async () => {
    worker = await startFakeWorker(ok);
    const app = appWith(worker.url);
    await request(app).get('/retraining/job/job-20260925-120000-abcd/log?tail=100000');
    await request(app).get('/retraining/versions/unet-ui0925-120000/preview?action=reject');
    await request(app).get('/retraining/versions/unet-ui0925-120000/preview?action=anything');
    expect(worker.seen.map(s => s.url)).toEqual([
      '/jobs/job-20260925-120000-abcd/log?tail=500',
      '/versions/unet-ui0925-120000/preview?action=reject',
      '/versions/unet-ui0925-120000/preview?action=activate',
    ]);
  });

  it('runs the guard before every route', async () => {
    worker = await startFakeWorker(ok);
    const app = appWith(worker.url, 'guest');
    const replies = await Promise.all([
      request(app).get('/retraining/status'),
      request(app).post('/retraining/eligible-cases/check'),
      request(app).post('/retraining/start'),
      request(app).get('/retraining/job/current'),
      request(app).get('/retraining/job/job-20260925-120000-abcd/log'),
      request(app).post('/retraining/job/job-20260925-120000-abcd/cancel'),
      request(app).get('/retraining/versions/unet-2026-05-01/preview'),
      request(app).post('/retraining/versions/unet-2026-05-01/activate').send({ confirm: [] }),
      request(app).post('/retraining/versions/unet-2026-05-01/reject').send({ confirm: [] }),
      request(app).get('/retraining/versions/unet-2026-05-01/results'),
      request(app).get('/retraining/versions/unet-2026-05-01/examples/0'),
    ]);
    for (const res of replies) expect(res.status).toBe(403);
    expect(worker.seen).toHaveLength(0);
  });

  it("tells the worker whose corrections to list, from the session", async () => {
    worker = await startFakeWorker(ok);
    const app = appWith(worker.url);
    await request(app).get('/retraining/status?owner=someone-else');
    await request(app).post('/retraining/eligible-cases/check').send({ requestedById: 'someone-else' });
    expect(worker.seen[0].url).toBe('/status?owner=u-user');
    expect(worker.seen[1]).toMatchObject({ url: '/eligible/check', body: { requestedBy: 'dr-user', requestedById: 'u-user' } });
  });

  it("forwards a version's results and one of its example scans", async () => {
    worker = await startFakeWorker(ok);
    const app = appWith(worker.url);
    await request(app).get('/retraining/versions/unet-ui0925-120000/results');
    await request(app).get('/retraining/versions/unet-ui0925-120000/examples/03');
    expect(worker.seen.map(s => s.url)).toEqual(['/versions/unet-ui0925-120000/results', '/versions/unet-ui0925-120000/examples/3']);
  });

  it('prepares a comparison with another version, and asks for its example scans, with valid names only', async () => {
    worker = await startFakeWorker(ok);
    const app = appWith(worker.url);
    await request(app).post('/retraining/versions/unet-ui0925-120000/compare').send({ against: 'unet-2026-05-01' });
    await request(app).get('/retraining/versions/unet-ui0925-120000/examples/2?against=unet-2026-05-01');
    expect(worker.seen.map(s => s.url)).toEqual(['/versions/unet-ui0925-120000/compare',
                                                 '/versions/unet-ui0925-120000/examples/2?against=unet-2026-05-01']);
    expect(worker.seen[0].body).toMatchObject({ against: 'unet-2026-05-01', requestedById: 'u-user' });
    for (const bad of [{ against: '../registry' }, { against: '' }, {}]) {
      expect((await request(app).post('/retraining/versions/unet-ui0925-120000/compare').send(bad)).status).toBe(400);
    }
    expect((await request(app).get('/retraining/versions/unet-ui0925-120000/examples/2?against=..%2Fx')).status).toBe(400);
    expect(worker.seen).toHaveLength(2);
  });

  it('is wired with isAuthAndNotGuest and mounted at /retraining', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../src/routes/retraining_routes.ts'), 'utf8');
    expect(routes).toMatch(/createRetrainingRouter\(\{\s*guard:\s*isAuthAndNotGuest\s*\}\)/);
    const appSource = fs.readFileSync(path.join(__dirname, '../src/services/express_app.ts'), 'utf8');
    expect(appSource).toMatch(/app\.use\('\/retraining',\s*retrainingRoute\)/);
  });
});
