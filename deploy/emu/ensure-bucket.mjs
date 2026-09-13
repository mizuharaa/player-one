// The S3 client the API uses (`S3ObjectStore` in packages/api/src/upload-worker.ts)
// never creates its bucket — it only PUTs and GETs inside one. On a fresh MinIO
// container the bucket does not exist yet, so `up.ps1` runs this once before
// starting the API. Idempotent: BucketAlreadyOwnedByYou is not an error here.
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const endpoint = process.env['STORAGE_ENDPOINT'];
const bucket = process.env['STORAGE_BUCKET'];
const key = process.env['STORAGE_KEY'];
const secret = process.env['STORAGE_SECRET'];
if (!endpoint || !bucket || !key || !secret) {
  console.error('ensure-bucket: STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_KEY and STORAGE_SECRET are all required');
  process.exit(2);
}

const client = new S3Client({
  endpoint,
  region: 'auto',
  forcePathStyle: true,
  credentials: { accessKeyId: key, secretAccessKey: secret },
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`bucket '${bucket}' already exists`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket '${bucket}' created`);
}
