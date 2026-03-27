import { S3Client, GetObjectCommand, GetObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import logger from "../services/logger"; // Assuming logger is in ../services/logger

const serviceLocation = "S3Utils";

let s3ClientInstance: S3Client | null = null;

const getS3Client = (): S3Client => {
    if (!s3ClientInstance) {
        const region = process.env.AWS_REGION || process.env.S3_REGION; // Allow S3_REGION as an alternative
        if (!region) {
            logger.error(`${serviceLocation}: AWS_REGION or S3_REGION environment variable is not set.`);
            throw new Error("S3 client region not configured. Please set AWS_REGION or S3_REGION.");
        }
        
        const s3Config: any = {
            region: region,
            // Credentials should be configured via environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
            // or an IAM role if running on EC2/ECS, or a shared credentials file.
            // The SDK will automatically attempt to load them.
        };

        // MinIO support: override endpoint for local development
        if (process.env.S3_ENDPOINT) {
            s3Config.endpoint = process.env.S3_ENDPOINT;
            s3Config.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
            logger.info(`${serviceLocation}: Using custom S3 endpoint: ${process.env.S3_ENDPOINT} (forcePathStyle: ${s3Config.forcePathStyle})`);
        }

        s3ClientInstance = new S3Client(s3Config);
        logger.info(`${serviceLocation}: S3Client initialized for region: ${region}`);
    }
    return s3ClientInstance;
};

/**
 * Generates a presigned GET URL for an S3 object.
 * @param bucket The S3 bucket name.
 * @param key The S3 object key.
 * @param expiresIn The duration in seconds for which the presigned URL is valid (default: 3600 seconds = 1 hour).
 * @returns A promise that resolves to the presigned URL string, or null if an error occurs.
 */
export const generatePresignedGetUrl = async (
    bucket: string,
    key: string,
    expiresIn: number = 3600
): Promise<string | null> => {
    if (!bucket || !key) {
        logger.error(`${serviceLocation}: Bucket name or object key is missing for generating presigned URL. Bucket: '${bucket}', Key: '${key}'`);
        return null;
    }

    try {
        const client = getS3Client();
        const commandInput: GetObjectCommandInput = {
            Bucket: bucket,
            Key: key,
        };
        const command = new GetObjectCommand(commandInput);

        const url = await getSignedUrl(client, command, { expiresIn });
        logger.info(`${serviceLocation}: Successfully generated presigned GET URL for s3://${bucket}/${key} (expires in ${expiresIn}s)`);
        return url;
    } catch (error: any) {
        logger.error(`${serviceLocation}: Error generating presigned GET URL for s3://${bucket}/${key}: ${error.message}`, {
            bucket,
            key,
            expiresIn,
            errorDetail: error, // Log the full error object for more details
        });
        return null;
    }
};