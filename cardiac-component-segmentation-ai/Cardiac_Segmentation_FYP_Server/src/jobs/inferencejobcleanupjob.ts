import cron from 'node-cron';
import { jobModel, projectModel, userModel } from '../services/database';
import logger from '../services/logger';
import cronstrue from 'cronstrue';

// Age threshold for old inference jobs (default: 3 days)
const JOB_AGE_THRESHOLD_MS = parseInt(process.env.INFERENCE_JOB_AGE_THRESHOLD_DAYS || '3', 10) * 24 * 60 * 60 * 1000;

const serviceLocation = "Inference Job Cleanup CRON";

/**
 * Cleanup orphaned and old inference jobs
 * - Deletes inference jobs whose associated project no longer exists
 * - Deletes inference jobs whose associated user no longer exists
 * - Deletes inference jobs older than 3 days (configurable)
 */
async function cleanupInferenceJobs(): Promise<void> {
    logger.info(`${serviceLocation}: Starting inference job cleanup...`);
    
    try {
        let totalDeletedCount = 0;
        
        // Step 1: Delete orphaned jobs (jobs with non-existent projects)
        logger.info(`${serviceLocation}: Step 1 - Checking for orphaned jobs (non-existent projects)...`);
        
        // Get all unique project IDs from jobs
        const jobProjectIds = await jobModel.distinct('projectid');
        logger.info(`${serviceLocation}: Found ${jobProjectIds.length} unique project IDs in inference jobs`);
        
        // Get all existing project IDs
        const existingProjects = await projectModel.find({}).select('_id').lean();
        const existingProjectIds = new Set(existingProjects.map(p => p._id.toString()));
        logger.info(`${serviceLocation}: Found ${existingProjectIds.size} existing projects in database`);
        
        // Find orphaned project IDs (in jobs but not in projects)
        const orphanedProjectIds = jobProjectIds.filter(id => !existingProjectIds.has(id));
        
        if (orphanedProjectIds.length > 0) {
            logger.info(`${serviceLocation}: Found ${orphanedProjectIds.length} orphaned project IDs`);
            const orphanedJobsResult = await jobModel.deleteMany({ 
                projectid: { $in: orphanedProjectIds } 
            });
            logger.info(`${serviceLocation}: Deleted ${orphanedJobsResult.deletedCount} orphaned inference jobs (non-existent projects)`);
            totalDeletedCount += orphanedJobsResult.deletedCount;
        } else {
            logger.info(`${serviceLocation}: No orphaned inference jobs found (all projects exist)`);
        }
        
        // Step 2: Delete orphaned jobs (jobs with non-existent users)
        logger.info(`${serviceLocation}: Step 2 - Checking for orphaned jobs (non-existent users)...`);
        
        // Get all unique user IDs from jobs
        const jobUserIds = await jobModel.distinct('userid');
        logger.info(`${serviceLocation}: Found ${jobUserIds.length} unique user IDs in inference jobs`);
        
        // Get all existing user IDs
        const existingUsers = await userModel.find({}).select('_id').lean();
        const existingUserIds = new Set(existingUsers.map(u => u._id.toString()));
        logger.info(`${serviceLocation}: Found ${existingUserIds.size} existing users in database`);
        
        // Find orphaned user IDs (in jobs but not in users)
        const orphanedUserIds = jobUserIds.filter(id => !existingUserIds.has(id));
        
        if (orphanedUserIds.length > 0) {
            logger.info(`${serviceLocation}: Found ${orphanedUserIds.length} orphaned user IDs`);
            const orphanedUserJobsResult = await jobModel.deleteMany({ 
                userid: { $in: orphanedUserIds } 
            });
            logger.info(`${serviceLocation}: Deleted ${orphanedUserJobsResult.deletedCount} orphaned inference jobs (non-existent users)`);
            totalDeletedCount += orphanedUserJobsResult.deletedCount;
        } else {
            logger.info(`${serviceLocation}: No orphaned inference jobs found (all users exist)`);
        }
        
        // Step 3: Delete old inference jobs (older than threshold)
        logger.info(`${serviceLocation}: Step 3 - Checking for old inference jobs (older than ${JOB_AGE_THRESHOLD_MS / (24 * 60 * 60 * 1000)} days)...`);
        
        const thresholdDate = new Date(Date.now() - JOB_AGE_THRESHOLD_MS);
        logger.info(`${serviceLocation}: Deleting jobs updated before: ${thresholdDate.toISOString()}`);
        
        const oldJobsResult = await jobModel.deleteMany({
            updatedAt: { $lt: thresholdDate }
        });
        
        logger.info(`${serviceLocation}: Deleted ${oldJobsResult.deletedCount} old inference jobs (older than ${JOB_AGE_THRESHOLD_MS / (24 * 60 * 60 * 1000)} days)`);
        totalDeletedCount += oldJobsResult.deletedCount;
        
        // Step 4: Summary
        logger.info(`${serviceLocation}: Inference job cleanup completed. Total deleted: ${totalDeletedCount} jobs`);
        
    } catch (error) {
        logger.error(`${serviceLocation}: Error during inference job cleanup:`, error);
    }
}

/**
 * Schedule the inference job cleanup CRON
 * - Runs on server boot
 * - Runs every 24 hours (configurable via INFERENCE_JOB_CLEANUP_CRON_SCHEDULE)
 */
export async function scheduleInferenceJobCleanup(): Promise<void> {
    const cronExpression = process.env.INFERENCE_JOB_CLEANUP_CRON_SCHEDULE || '0 2 * * *'; // Default to daily at 2:00 AM
    const cronDescription = cronstrue.toString(cronExpression, { throwExceptionOnParseError: true });
    
    // Schedule the CRON job
    cron.schedule(cronExpression, cleanupInferenceJobs);
    logger.info(`${serviceLocation}: Scheduled to run ${cronDescription} (${cronExpression})`);
    
    // Run immediately on startup
    logger.info(`${serviceLocation}: Running initial cleanup on server boot...`);
    await cleanupInferenceJobs();
}
