import cron from 'node-cron';
import { readUser, deleteUser, UserRole, } from '../services/database';
import logger from '../services/logger';
import { cleanupUserS3Storage } from '../services/s3_handler';
import cronstrue from 'cronstrue';

let INACTIVE_THRESHOLD_MS = parseInt(process.env.GUEST_INACTIVITY_THRESHOLD_HOURS || '24', 10) * 60 * 60 * 1000; // Default 24 hours
// If development, set to 0 to trigger immediate cleanup
if (process.env.NODE_ENV === 'development') INACTIVE_THRESHOLD_MS = 0; // For testing purposes, set to 0 to trigger immediate cleanup

const serviceLocation = "Guest Cleanup CRON";

async function cleanupInactiveGuests(): Promise<void> {
    logger.info('GuestCleanupJob: Starting inactive guest cleanup...');
    try {
        // const guestUser: Partial<IUser> = { role: UserRole.Guest };
        const readResult = await readUser({ role: UserRole.Guest }); // Adjust query to match your schema

        if (!readResult.success || !readResult.users) {
            logger.warn('GuestCleanupJob: Could not retrieve guest users or no guests found.');
            return;
        }

        const now = Date.now();
        let cleanedCount = 0;

        for (const guest of readResult.users) {
            // Ensure lastActivityAt exists, fallback to createdAt if necessary (add to schema)
            const lastActivity = guest.updatedAt?.getTime() || guest.createdAt?.getTime();

            if (!lastActivity) {
                logger.warn(`GuestCleanupJob: Guest ${guest._id} missing activity timestamp. Skipping.`);
                continue;
            }

            if (now - lastActivity > INACTIVE_THRESHOLD_MS) {
                logger.info(`GuestCleanupJob: Found inactive guest ${guest.username} (${guest._id}). Last active: ${new Date(lastActivity).toISOString()}. Cleaning up...`);

                // Step 1: Cleanup S3 files
                await cleanupUserS3Storage(guest._id);

                // 2. Delete DB Records
                const deleteResult = await deleteUser(guest._id);
                if (deleteResult.success) {
                    logger.info(`GuestCleanupJob: Successfully deleted guest ${guest.username} (${guest._id}).`);
                    cleanedCount++;
                } else {
                    logger.error(`GuestCleanupJob: Failed to delete guest ${guest.username} (${guest._id}): ${deleteResult.message}`);
                }
            }
        }
        logger.info(`GuestCleanupJob: Finished cleanup. Removed ${cleanedCount} inactive guests.`);

    } catch (error) {
        logger.error(`GuestCleanupJob: Error during cleanup: ${error}`);
    }
}

// Schedule the job (e.g., run every day at 3:00 AM)
export async function scheduleGuestCleanup(): Promise<void> {
    const cronExpression = process.env.GUEST_CLEANUP_CRON_SCHEDULE || '0 3 * * *'; // Default to daily at 3:00 AM
    const cronDescription = cronstrue.toString(cronExpression, { throwExceptionOnParseError: true });
    // Log the cron schedule description
    cron.schedule(cronExpression, cleanupInactiveGuests);
    logger.info(`${serviceLocation}: Scheduled to run daily ${cronDescription} (${cronExpression})`);

    // Optional: Run once on startup after a delay
    // setTimeout(cleanupInactiveGuests, 5 * 60 * 1000); // Run 5 mins after start

    // Optional: Run immediately on startup
    await cleanupInactiveGuests(); // Uncomment to run immediately on startup
}