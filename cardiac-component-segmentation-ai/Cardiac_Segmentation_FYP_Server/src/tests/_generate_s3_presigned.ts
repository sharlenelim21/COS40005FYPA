// This script generates a presigned URL for an S3 object.
// It is used for testing purposes to verify that the S3 client is working correctly.
// Run with: npx ts-node ./src/tests/_generate_s3_presigned.ts <bucket-name> <object-key> [expiresIn-seconds]
// Or add in .env files:
// DEV_S3_BUCKET_NAME=<your-bucket-name>
// DEV_S3_OBJECT_KEY=<your-object-key>
// DEV_AWS_REGION=<your-region> (default: ap-southeast-1)

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function generatePresignedUrl() {
    // Get command line arguments or use defaults
    const args = process.argv.slice(2);
    const bucketName = args[0] || process.env.DEV_S3_BUCKET_NAME;
    const objectKey = args[1] || process.env.DEV_S3_OBJECT_KEY;
    const expiresIn = parseInt(args[2] || '60', 10); // Default to 1 minute
    const operation = (args[3] || 'get').toLowerCase(); // 'get' or 'put'

    // Validate required parameters
    if (!bucketName || !objectKey) {
        console.error('Usage: node _generate_s3_presigned.js <bucket-name> <object-key> [expiresIn-seconds] [get|put]');
        console.error('Or set S3_BUCKET_NAME environment variable and provide just the object key');
        process.exit(1);
    }

    try {
        // Create S3 client using AWS SDK v3
        const s3Client = new S3Client({
            region: process.env.DEV_AWS_REGION || 'ap-southeast-1',
            // Credentials will be loaded from environment variables or EC2 instance role
        });

        // Create command based on operation
        let command;
        if (operation === 'put') {
            command = new PutObjectCommand({
                Bucket: bucketName,
                Key: objectKey,
                ContentType: 'application/octet-stream', // Adjust as needed
            });
        } else {
            command = new GetObjectCommand({
                Bucket: bucketName,
                Key: objectKey,
            });
        }

        // Generate the presigned URL
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });

        // Output results in a user-friendly format
        console.log('\n=== S3 PRESIGNED URL GENERATED SUCCESSFULLY ===');
        console.log(`\nURL (expires in ${expiresIn} seconds):`);
        console.log(`\n${presignedUrl}\n`);
        console.log(`To test with curl (${operation === 'put' ? 'upload' : 'download'}):`);
        if (operation === 'put') {
            console.log(`\ncurl -X PUT -H "Content-Type: application/octet-stream" --data-binary @local-file.txt "${presignedUrl}"\n`);
        } else {
            console.log(`\ncurl -o downloaded-file.txt "${presignedUrl}"\n`);
        }
    } catch (error) {
        console.error('Error generating presigned URL:', error);
        process.exit(1);
    }
}

// Execute the function
generatePresignedUrl();