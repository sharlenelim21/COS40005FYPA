// File: src/routes/retraining_routes.ts
// Description: The UNet Extend Training API (plan WS13), for users and admins, never guests. Only an admin may train or
// change the model in use. The forwarding itself lives in services/retraining_proxy.ts, so it can be tested without a
// session store.
import { createRetrainingRouter } from '../services/retraining_proxy';
import { isAuthAndAdmin, isAuthAndNotGuest } from '../services/passportjs';
import { projectModel } from '../services/database';
import { extractS3KeyFromUrl } from '../services/s3_handler';
import { generatePresignedGetUrl } from '../utils/s3_presigned_url';

const IMAGES_URL_SECONDS = 1800; // as /project/get-project-presigned-url

/** A project's slice images (its extracted tar), as the editor downloads them, without the owner filter. */
async function projectImages(projectId: string): Promise<{ presignedUrl: string; expiresAt: number } | null> {
  const project = await projectModel.findById(projectId).select('extractedfolderpath').lean() as
    { extractedfolderpath?: string } | null;
  const key = project?.extractedfolderpath ? extractS3KeyFromUrl(project.extractedfolderpath) : null;
  if (!key) return null;
  const presignedUrl = await generatePresignedGetUrl(process.env.AWS_BUCKET_NAME!, key, IMAGES_URL_SECONDS);
  return presignedUrl ? { presignedUrl, expiresAt: Date.now() + IMAGES_URL_SECONDS * 1000 } : null;
}

export default createRetrainingRouter({ guard: isAuthAndNotGuest, adminGuard: isAuthAndAdmin, projectImages });
