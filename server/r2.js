const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");

let s3Client = null;

function getClient() {
  if (s3Client) return s3Client;
  if (!isR2Configured()) return null;
  const endpoint = process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined;
  s3Client = new S3Client({
    region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1",
    ...(endpoint ? { endpoint } : {}),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

function getBucket() {
  return process.env.S3_BUCKET_NAME || process.env.R2_BUCKET_NAME;
}

function isR2Configured() {
  const hasCredentials = !!(
    (process.env.AWS_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID) &&
    (process.env.AWS_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY)
  );
  return !!(hasCredentials && getBucket());
}

async function uploadToR2(key, buffer, contentType) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

async function downloadFromR2(key) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  const resp = await client.send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function streamFromR2(key, range) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  const params = { Bucket: getBucket(), Key: key };
  if (range) params.Range = range;
  const resp = await client.send(new GetObjectCommand(params));
  return {
    stream: resp.Body,
    contentLength: resp.ContentLength,
    contentType: resp.ContentType,
    contentRange: resp.ContentRange,
    acceptRanges: resp.AcceptRanges,
  };
}

async function deleteFromR2(key) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  await client.send(new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));
}

async function createMultipartUpload(key, contentType) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  const resp = await client.send(new CreateMultipartUploadCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  }));
  return resp.UploadId;
}

async function uploadPart(key, uploadId, partNumber, buffer) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  const resp = await client.send(new UploadPartCommand({
    Bucket: getBucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: buffer,
  }));
  return { ETag: resp.ETag, PartNumber: partNumber };
}

async function completeMultipartUpload(key, uploadId, parts) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: getBucket(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
  }));
}

async function abortMultipartUpload(key, uploadId) {
  const client = getClient();
  if (!client) throw new Error("S3 not configured");
  await client.send(new AbortMultipartUploadCommand({
    Bucket: getBucket(),
    Key: key,
    UploadId: uploadId,
  }));
}

module.exports = {
  isR2Configured,
  uploadToR2,
  downloadFromR2,
  streamFromR2,
  deleteFromR2,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
};
