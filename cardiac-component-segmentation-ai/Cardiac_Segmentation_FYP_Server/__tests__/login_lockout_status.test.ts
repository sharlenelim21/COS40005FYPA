import express from 'express';
import request from 'supertest';
import * as bcrypt from 'bcrypt';

// The real login route, Passport strategy and authenticateUser (lockout counters included); only Redis (in memory)
// and the user lookup are stand-ins. A wrong password is 401 even though its message mentions "locked"; only a real
// lockout is 423 (authenticateUser's `locked` flag, not the wording).
const store = new Map<string, string>();
const fakeRedis = {
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  set: jest.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
  incr: jest.fn(async (key: string) => { const n = Number(store.get(key) ?? 0) + 1; store.set(key, String(n)); return n; }),
  expire: jest.fn(async () => 1),
  ttl: jest.fn(async () => 600),
  del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};
jest.mock('../src/services/redis', () => ({ redisClient: fakeRedis, connectRedis: jest.fn(), checkRedisHealth: jest.fn() }));
jest.mock('../src/services/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/utils/error_logger', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../src/services/s3_handler', () => ({ cleanupUserS3Storage: jest.fn() }));
jest.mock('../src/jobs/projectcleanupjob', () => ({ handleUserSaveUnsave: jest.fn() }));

// eslint-disable-next-line import/first
import { userModel } from '../src/services/database';
// eslint-disable-next-line import/first
import router from '../src/routes/authentication';

const PASSWORD = 'Right#Pass1';
const hash = bcrypt.hashSync(PASSWORD, 4);
const app = express();
app.use(express.json());
app.use('/auth', router);
const login = (username: string, password: string) => request(app).post('/auth/login').send({ username, password });

beforeEach(() => {
    store.clear();
    jest.spyOn(userModel, 'findOne').mockImplementation(((filter: { username: string }) => ({
        select: async () => ({ _id: 'u1', username: filter.username, password: hash, role: 'user', email: 'u@example.test' }),
    })) as never);
});

describe('Login status: 401 for a wrong password, 423 only for a real lockout', () => {
    it('a wrong password is 401, though its message says how many attempts remain "before account is locked"', async () => {
        const res = await login('wrong_pw_user', 'Wrong#Pass1');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ login: false,
            message: 'Invalid username or password. 4 attempts remaining before account is locked.' });
    });

    it('the attempt that locks the account is 423, and so is every attempt while it stays locked', async () => {
        for (let attempt = 1; attempt <= 4; attempt++) {
            expect((await login('lock_me', 'Wrong#Pass1')).status).toBe(401);
        }
        const locking = await login('lock_me', 'Wrong#Pass1');
        expect(locking.status).toBe(423);
        expect(locking.body.message).toMatch(/^Too many failed login attempts\. Account locked/);
        const whileLocked = await login('lock_me', PASSWORD);     // even the right password waits out the lock
        expect(whileLocked.status).toBe(423);
        expect(whileLocked.body.message).toMatch(/^Account temporarily locked/);
    });
});
