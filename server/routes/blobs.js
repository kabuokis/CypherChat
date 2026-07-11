import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const STORAGE_LIMIT_BYTES = 9.5 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const STORAGE_LIMIT_GB = (STORAGE_LIMIT_BYTES / 1024 / 1024 / 1024).toFixed(1);
const MAX_FILE_MB = (MAX_FILE_BYTES / 1024 / 1024).toFixed(0);

let s3 = null;
let db = null;

function initS3() {
  if (s3) return s3;
  const R2_ENDPOINT = process.env.R2_ENDPOINT;
  const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
  const R2_BUCKET = process.env.R2_BUCKET_NAME;

  if (R2_ENDPOINT && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return s3;
}

function getBucket() {
  return process.env.R2_BUCKET_NAME;
}

function getPublicUrl() {
  return process.env.R2_PUBLIC_URL;
}

async function getBucketSize() {
  const client = initS3();
  if (!client) return 0;
  let total = 0;
  let continuationToken = null;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: getBucket(),
      MaxKeys: 1000,
      ContinuationToken: continuationToken
    }));

    for (const obj of response.Contents || []) {
      total += obj.Size;
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return total;
}

async function listOldestObjects(limit = 100) {
  const client = initS3();
  if (!client) return [];
  const response = await client.send(new ListObjectsV2Command({
    Bucket: getBucket(),
    MaxKeys: limit
  }));

  return (response.Contents || []).sort((a, b) => a.LastModified - b.LastModified);
}

async function deleteObject(key) {
  const client = initS3();
  if (!client) return;
  await client.send(new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key
  }));
}

async function enforceStorageLimit(requiredBytes = 0) {
  let currentSize = await getBucketSize();
  const targetSize = STORAGE_LIMIT_BYTES - requiredBytes;

  while (currentSize > targetSize) {
    const oldest = await listOldestObjects(50);
    if (oldest.length === 0) break;

    for (const obj of oldest) {
      if (currentSize <= targetSize) break;

      try {
        await deleteObject(obj.Key);
        await db.query('DELETE FROM blobs WHERE storage_key = $1', [obj.Key]);
        currentSize -= obj.Size;
      } catch (e) {
        console.error('Failed to delete', obj.Key, e.message);
      }
    }
  }

  return currentSize;
}

export default async function blobRoutes(app, opts) {
  db = app.db;
  initS3();

  app.post('/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    const client = initS3();
    if (!client) {
      return reply.code(503).send({ error: 'Blob storage not configured' });
    }

    const { filename, contentType, estimatedSize } = request.body;

    // Server-side size validation
    if (!estimatedSize || estimatedSize > MAX_FILE_BYTES) {
      return reply.code(413).send({
        error: `File too large. Maximum is ${MAX_FILE_MB}MB. Your file: ${estimatedSize ? (estimatedSize / 1024 / 1024).toFixed(1) : 'unknown'}MB`
      });
    }

    const requiredBytes = estimatedSize;

    try {
      await enforceStorageLimit(requiredBytes);
    } catch (e) {
      console.error('Storage limit enforcement failed:', e.message);
    }

    const storageKey = `${crypto.randomUUID()}-${filename}`;

    try {
      const putCommand = new PutObjectCommand({
        Bucket: getBucket(),
        Key: storageKey,
        ContentType: contentType || 'application/octet-stream',
      });

      const getCommand = new GetObjectCommand({
        Bucket: getBucket(),
        Key: storageKey,
      });

      const [putUrl, getUrl] = await Promise.all([
        getSignedUrl(client, putCommand, { expiresIn: 300 }),
        getSignedUrl(client, getCommand, { expiresIn: 86400 * 7 }),
      ]);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.query(
        'INSERT INTO blobs (storage_key, expires_at) VALUES ($1, $2)',
        [storageKey, expiresAt]
      );

      return {
        putUrl,
        getUrl: getPublicUrl() ? `${getPublicUrl()}/${storageKey}` : getUrl,
        storageKey
      };
    } catch (e) {
      console.error('Presign error:', e);
      return reply.code(500).send({ error: 'Failed to generate upload URL: ' + e.message });
    }
  });
}