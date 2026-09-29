// File: src/services/retraining_proxy.ts
// Description: The UNet Extend Training API (plan WS13). Every call passes the guard, is checked here, and is then
// forwarded to the training service on this computer (visheart-retraining/worker.py, 127.0.0.1:8010 on the host).
// The service trusts this server, so the user's name and id always come from the session, never from the request. The
// id decides whose corrections are listed and exported: each user prepares their own (plan WS13 R1).
import express, { Request, RequestHandler, Response, Router } from 'express';
import axios, { AxiosInstance } from 'axios';
import logger from './logger';

const serviceLocation = 'API (Extend Training)';
export const DEFAULT_WORKER_URL = 'http://host.docker.internal:8010';
export const WORKER_OFFLINE_MESSAGE =
  'The training service is not running on this computer. Start it with start-retraining-worker.bat in visheart-retraining.';
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const JOB_ID = /^job-\d{8}-\d{6}-[0-9a-f]{4}$/;
const MASK_ID = /^[0-9a-f]{24}$/;
const MAX_SELECTION = 500;
const EXAMPLE = /^\d{1,2}$/;

export interface RetrainingRouterOptions {
  guard: RequestHandler; // who may use the page: isAuthAndNotGuest in production
  workerUrl?: string; // default: RETRAINING_WORKER_URL, then DEFAULT_WORKER_URL
  timeoutMs?: number; // default for quick calls
}

interface WorkerBody {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

export function createRetrainingRouter(options: RetrainingRouterOptions): Router {
  const router = express.Router();
  const worker: AxiosInstance = axios.create({
    baseURL: options.workerUrl ?? process.env.RETRAINING_WORKER_URL ?? DEFAULT_WORKER_URL,
    timeout: options.timeoutMs ?? 30000,
    validateStatus: () => true, // the worker's own status is passed through
    headers: { 'Content-Type': 'application/json' },
  });

  const sessionUser = (req: Request): { username: string; userId: string } => {
    const user = req.user as { username?: string; _id?: unknown } | undefined;
    return { username: user?.username ?? 'unknown', userId: user?._id ? String(user._id) : '' };
  };

  const forward = async (req: Request, res: Response, method: 'get' | 'post', target: string,
                         body: Record<string, unknown> = {}, timeout?: number): Promise<void> => {
    const { username, userId } = sessionUser(req);
    logger.info(`${serviceLocation}: ${username} ${method.toUpperCase()} ${target}`);
    try {
      const reply = method === 'get'
        ? await worker.get<WorkerBody>(target, { timeout })
        : await worker.post<WorkerBody>(target, { ...body, requestedBy: username, requestedById: userId }, { timeout });
      const ok = reply.status < 400 && reply.data?.ok === true;
      res.status(reply.status).json({
        success: ok,
        message: ok ? 'OK' : String(reply.data?.error ?? 'The training service refused the request.'),
        data: reply.data?.data ?? null,
      });
    } catch (error) {
      logger.warn(`${serviceLocation}: training service unreachable: ${(error as Error).message}`);
      res.status(503).json({ success: false, message: WORKER_OFFLINE_MESSAGE, data: { workerOnline: false } });
    }
  };

  const badRequest = (res: Response, message: string): void => {
    res.status(400).json({ success: false, message, data: null });
  };

  const confirmLines = (req: Request): string[] | null => {
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    return Array.isArray(confirm) && confirm.every(line => typeof line === 'string') ? (confirm as string[]) : null;
  };

  router.use(options.guard); // in front of every route below, without exception

  router.get('/status', (req, res) => {
    const { userId } = sessionUser(req);
    return forward(req, res, 'get', userId ? `/status?owner=${encodeURIComponent(userId)}` : '/status');
  });
  router.post('/eligible-cases/check', (req, res) => forward(req, res, 'post', '/eligible/check', {}, 180000));
  router.post('/start', (req, res) => {
    const selection = (req.body as { selection?: unknown } | undefined)?.selection;
    if (!Array.isArray(selection) || selection.length === 0 || selection.length > MAX_SELECTION
        || !selection.every(id => typeof id === 'string' && MASK_ID.test(id))) {
      return badRequest(res, 'Choose the cases to train on.');
    }
    return forward(req, res, 'post', '/jobs/train', { selection });
  });
  router.get('/job/current', (req, res) => forward(req, res, 'get', '/jobs/current'));

  router.get('/job/:jobId/log', (req, res) => {
    const { jobId } = req.params;
    if (!JOB_ID.test(jobId)) return badRequest(res, 'Unknown job.');
    const tail = Math.min(Math.max(parseInt(String(req.query.tail ?? '200'), 10) || 200, 1), 500);
    return forward(req, res, 'get', `/jobs/${jobId}/log?tail=${tail}`);
  });

  router.post('/job/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    if (!JOB_ID.test(jobId)) return badRequest(res, 'Unknown job.');
    return forward(req, res, 'post', `/jobs/${jobId}/cancel`);
  });

  router.get('/versions/:label/preview', (req, res) => {
    const { label } = req.params;
    if (!LABEL.test(label)) return badRequest(res, 'Unknown version.');
    const action = req.query.action === 'reject' ? 'reject' : 'activate';
    return forward(req, res, 'get', `/versions/${label}/preview?action=${action}`);
  });

  router.post('/versions/:label/activate', (req, res) => {
    const { label } = req.params;
    if (!LABEL.test(label)) return badRequest(res, 'Unknown version.');
    const confirm = confirmLines(req);
    if (!confirm) return badRequest(res, 'The confirmation is missing.');
    return forward(req, res, 'post', `/versions/${label}/activate`, { confirm }, 240000);
  });

  router.post('/versions/:label/reject', (req, res) => {
    const { label } = req.params;
    if (!LABEL.test(label)) return badRequest(res, 'Unknown version.');
    const confirm = confirmLines(req);
    if (!confirm) return badRequest(res, 'The confirmation is missing.');
    return forward(req, res, 'post', `/versions/${label}/reject`, { confirm });
  });

  router.get('/versions/:label/results', (req, res) => {
    const { label } = req.params;
    if (!LABEL.test(label)) return badRequest(res, 'Unknown version.');
    return forward(req, res, 'get', `/versions/${label}/results`, {}, 60000);
  });

  router.get('/versions/:label/examples/:n', (req, res) => {
    const { label, n } = req.params;
    if (!LABEL.test(label) || !EXAMPLE.test(n)) return badRequest(res, 'Unknown example scan.');
    return forward(req, res, 'get', `/versions/${label}/examples/${Number(n)}`, {}, 60000);
  });

  return router;
}
