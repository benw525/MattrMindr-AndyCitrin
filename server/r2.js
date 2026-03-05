const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");

let s3Client = null;

function getClient() {
  if (s3Client) return s3Client;
  if (!isR2Configured()) return null;
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

function isR2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

async function uploadToR2(key, buffer, contentType) {
  const client = getClient();
  if (!client) throw new Error("R2 not configured");
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

async function downloadFromR2(key) {
  const client = getClient();
  if (!client) throw new Error("R2 not configured");
  const resp = await client.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
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
  if (!client) throw new Error("R2 not configured");
  const params = { Bucket: process.env.R2_BUCKET_NAME, Key: key };
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
  if (!client) throw new Error("R2 not configured");
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  }));
}

async function createMultipartUpload(key, contentType) {
  const client = getClient();
  if (!client) throw new Error("R2 not configured");
  const resp = await client.send(new CreateMultipartUploadCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  }));
  return resp.UploadId;
}

async function uploadPart(key, uploadId, partNumber, buffer) {
  const client = getClient();
  if (!client) throw new Error("R2 not configured");
  const resp = await client.send(new UploadPartCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: buffer,
  }));
  return { ETag: resp.ETag, PartNumber: partNumber };
}

async function completeMultipartUpload(key, uploadId, parts) {
  const client = getClient();
  if (!client) throw new Error("R2 not configured");
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
  }));
}

async function abortMultipartUpload(key, uploadId) {
  const client = getClient();
  if (!client) throw new Error("R2 not configured");
  await client.send(new AbortMultipartUploadCommand({
    Bucket: process.env.R2_BUCKET_NAME,
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
