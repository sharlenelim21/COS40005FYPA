import express from 'express';
import request from 'supertest';
import { compressJson } from '../src/middleware/compress_json';

// A segmentation result is mostly RLE text: long runs of digits and spaces.
const big = { segmentations: Array.from({ length: 200 }, (_, i) => ({ frame: i, rle: '12 34 56 78 '.repeat(50) })) };

function app() {
  const server = express();
  server.use(compressJson());
  server.get('/big', (_req, res) => { res.json(big); });
  server.get('/small', (_req, res) => { res.json({ ok: true }); });
  server.get('/text', (_req, res) => { res.type('text').send('x'.repeat(5000)); });
  return server;
}

// The body as bytes (supertest has already un-gzipped it).
const raw = (req: request.Test) => req.buffer(true).parse((res, done) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
});

describe('compressJson', () => {
  it('gzips a large JSON reply when the client accepts gzip, and it decodes to the same JSON', async () => {
    const res = await raw(request(app()).get('/big').set('Accept-Encoding', 'gzip'));
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toMatch(/Accept-Encoding/i);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // supertest un-gzips the body itself; Content-Length is what went over the wire.
    expect(JSON.parse((res.body as Buffer).toString('utf8'))).toEqual(big);
    const sent = Number(res.headers['content-length']);
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(Buffer.byteLength(JSON.stringify(big)) / 5);
  });

  it('leaves small replies, clients without gzip, and non-JSON replies as they were', async () => {
    const small = await request(app()).get('/small').set('Accept-Encoding', 'gzip');
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(small.body).toEqual({ ok: true });

    const plain = await request(app()).get('/big').set('Accept-Encoding', 'identity');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toEqual(big);

    const text = await request(app()).get('/text').set('Accept-Encoding', 'gzip');
    expect(text.headers['content-encoding']).toBeUndefined();
    expect(text.text).toBe('x'.repeat(5000));
  });
});
