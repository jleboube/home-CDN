import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Configure the S3 client (reads credentials from environment or IAM role)
const s3 = new S3Client({ region: process.env.AWS_REGION })

export async function presign(key) {
  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET,
    Key: key, // The object key (e.g., 'uploads/my-image.jpg')
  })
  // Generate a URL valid for 60 seconds
  try {
    return await getSignedUrl(s3, command, { expiresIn: 60 })
  } catch (error) {
    console.error(`Error generating pre-signed URL for key ${key}:`, error)
    throw new Error('Could not generate pre-signed URL')
  }
}