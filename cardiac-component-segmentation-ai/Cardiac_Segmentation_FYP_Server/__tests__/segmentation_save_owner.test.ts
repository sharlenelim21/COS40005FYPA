import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

// The route file's services, replaced: only who owns the project and whether anything was written matter here.
const database = {
  readProject: jest.fn(),
  readProjectSegmentationMask: jest.fn(),
  updateProjectSegmentationMask: jest.fn(),
  updateProject: jest.fn(),
};
jest.mock('../src/services/database', () => ({
  ...database, jobModel: {}, userModel: {}, JobStatus: {}, projectSegmentationMaskModel: {}, projectLandmarkModel: {},
}));
jest.mock('../src/services/passportjs', () => {
  const pass = (_req: Request, _res: Response, next: NextFunction) => next();
  return { isAuth: pass, isAuthAndAdmin: pass, isAuthAndNotGuest: pass };
});
jest.mock('../src/services/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/inference', () => ({}));
jest.mock('../src/middleware/gpuauthmiddleware', () => ({ injectGpuAuthToken: jest.fn() }));
jest.mock('../src/services/segmentation_export', () => ({}));
jest.mock('../src/services/edit_tracking', () => ({ computeAndStoreEditTracking: jest.fn() }));
jest.mock('../src/utils/s3_presigned_url', () => ({}));
jest.mock('../src/services/s3_handler', () => ({}));
jest.mock('../src/services/gpu_auth_client', () => ({}));

// eslint-disable-next-line import/first
import router from '../src/routes/segmentation_routes';

const PROJECT = 'a'.repeat(24);

function appFor(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: { _id: string } }).user = { _id: userId };
    next();
  });
  app.use('/segmentation', router);
  return app;
}

/** readProject(projectId, userId) finds the project only for its owner, as the userid filter does. */
function ownedBy(owner: string) {
  database.readProject.mockImplementation(async (_projectId: string, userId: string) =>
    (userId === owner ? { success: true, projects: [{ _id: PROJECT, isSaved: true }] } : { success: true }));
}

describe("Saving a segmentation is for the project's owner only (BUG-017)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses another user's manual save before anything is written", async () => {
    ownedBy('u-owner');
    const res = await request(appFor('u-other')).put(`/segmentation/save-manual-segmentation/${PROJECT}`)
      .send({ frames: [], model: 'unet' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "Only the project's owner can save its segmentation." });
    expect(database.readProject).toHaveBeenCalledWith(PROJECT, 'u-other');
    expect(database.readProjectSegmentationMask).not.toHaveBeenCalled();
    expect(database.updateProjectSegmentationMask).not.toHaveBeenCalled();
  });

  it("lets the owner's manual save through to the masks", async () => {
    ownedBy('u-owner');
    database.readProjectSegmentationMask.mockResolvedValue({ success: false, message: 'Project does not exist' });
    const res = await request(appFor('u-owner')).put(`/segmentation/save-manual-segmentation/${PROJECT}`)
      .send({ frames: [], model: 'unet' });
    expect(res.status).not.toBe(403);
    expect(database.readProjectSegmentationMask).toHaveBeenCalledWith(PROJECT);
  });

  it("refuses another user's AI save, and passes the owner's", async () => {
    ownedBy('u-owner');
    database.readProjectSegmentationMask.mockResolvedValue({ success: true, projectsegmentationmask: { projectid: PROJECT } });
    database.updateProjectSegmentationMask.mockResolvedValue({ success: true, projectsegmentationmask: { _id: 'm1' } });
    const refused = await request(appFor('u-other')).patch('/segmentation/save-ai-segmentation').send({ segmentationMaskId: 'm1' });
    expect(refused.status).toBe(403);
    expect(database.updateProjectSegmentationMask).not.toHaveBeenCalled();
    await request(appFor('u-owner')).patch('/segmentation/save-ai-segmentation').send({ segmentationMaskId: 'm1' });
    expect(database.updateProjectSegmentationMask).toHaveBeenCalledWith('m1', { isSaved: true });
  });

  it('answers 500, not 403, when the project cannot be read', async () => {
    database.readProject.mockResolvedValue({ success: false, message: 'Error reading projects.' });
    const res = await request(appFor('u-owner')).put(`/segmentation/save-manual-segmentation/${PROJECT}`)
      .send({ frames: [], model: 'unet' });
    expect(res.status).toBe(500);
    expect(database.updateProjectSegmentationMask).not.toHaveBeenCalled();
  });
});
