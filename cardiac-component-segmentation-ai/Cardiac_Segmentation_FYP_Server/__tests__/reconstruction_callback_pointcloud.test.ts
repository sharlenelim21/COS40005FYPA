declare const jest: any;
declare const describe: any;
declare const it: any;
declare const expect: any;
declare const beforeAll: any;
declare const afterAll: any;
declare const beforeEach: any;
declare const afterEach: any;

import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../src/services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/services/reconstruction_handler', () => ({
  processReconstructionCallback: jest.fn(),
}));

import webhookRoute from '../src/routes/webhook_routes';
import { processReconstructionCallback } from '../src/services/reconstruction_handler';

describe('GPU reconstruction callback multipart integration', () => {
  const app = express();
  app.use('/webhook', webhookRoute);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-callback-test-'));
  const meshFile = path.join(tempDir, 'sample_frame00.obj');
  const pointCloudFile = path.join(tempDir, 'sample_frame00_pointcloud.npy');

  beforeAll(() => {
    fs.writeFileSync(meshFile, 'v 0 0 0\nv 1 0 0\nf 1 2 1\n', 'utf-8');
    const npyHeader = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]);
    fs.writeFileSync(pointCloudFile, npyHeader);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    (processReconstructionCallback as any).mockResolvedValue({
      success: true,
      message: 'ok',
      reconstructionId: 'recon-1',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('forwards mesh and point cloud files to reconstruction handler', async () => {
    const metadata = {
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'completed',
      result: {
        total_mesh_files: 1,
        total_point_cloud_files: 1,
      },
      error: null,
    };

    const response = await request(app)
      .post('/webhook/gpu-reconstruction-callback')
      .set('X-Job-ID', 'job-test-123')
      .field('metadata', JSON.stringify(metadata))
      .attach('mesh_0', meshFile)
      .attach('point_cloud_0', pointCloudFile);

    expect(response.status).toBe(200);
    expect(processReconstructionCallback).toHaveBeenCalledTimes(1);

    const [jobId, meshFiles, pointCloudFiles, callbackMetadata] =
      (processReconstructionCallback as any).mock.calls[0];

    expect(jobId).toBe('job-test-123');
    expect(meshFiles).toHaveLength(1);
    expect(pointCloudFiles).toHaveLength(1);
    expect(meshFiles[0].originalname.endsWith('.obj')).toBe(true);
    expect(pointCloudFiles[0].originalname.endsWith('.npy')).toBe(true);
    expect(callbackMetadata.status).toBe('completed');
  });
});
