import cron from 'node-cron';
import cronstrue from 'cronstrue';
import { jobModel, JobStatus } from '../services/database';
import { STALE_LANDMARK_JOB_MINUTES } from '../services/landmark_inference';
import logger from '../services/logger';

const serviceLocation = "Stale Landmark Job Sweep CRON";

export async function failStaleLandmarkJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_LANDMARK_JOB_MINUTES * 60 * 1000);
    try {
        const result = await jobModel.updateMany(
            {
                model_used: /landmark/i,
                status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] },
                createdAt: { $lt: cutoff },
            },
            {
                $set: {
                    status: JobStatus.FAILED,
                    message: `Landmark detection timed out: no result from the GPU service within ${STALE_LANDMARK_JOB_MINUTES} minutes.`,
                },
            },
        );
        if (result.modifiedCount > 0) {
            logger.warn(`${serviceLocation}: Marked ${result.modifiedCount} stale landmark job(s) as failed (older than ${STALE_LANDMARK_JOB_MINUTES} min).`);
        }
        return result.modifiedCount;
    } catch (error) {
        logger.error(`${serviceLocation}: Error failing stale landmark jobs:`, error);
        return 0;
    }
}

export async function scheduleStaleLandmarkJobSweep(): Promise<void> {
    const cronExpression = process.env.STALE_LANDMARK_JOB_SWEEP_CRON_SCHEDULE || '*/5 * * * *';
    const cronDescription = cronstrue.toString(cronExpression, { throwExceptionOnParseError: true });

    cron.schedule(cronExpression, () => { void failStaleLandmarkJobs(); });
    logger.info(`${serviceLocation}: Scheduled to run ${cronDescription} (${cronExpression})`);

    logger.info(`${serviceLocation}: Running initial sweep on server boot...`);
    await failStaleLandmarkJobs();
}
