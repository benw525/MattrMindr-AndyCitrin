const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");

let s3Client = null;

function getClient() {
  if (s3Client) return s3Client;
  if (!isS3Configured()) return null;
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

function getBucket() {
  return process.env.S3_BUCKET_NAME;
}

function isS3Configured() {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    getBucket()
  );
}

async function uploadToS3(key, buffer, contentType) {
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

async function downloadFromS3(key) {
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

async function streamFromS3(key, range) {
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

async function deleteFromS3(key) {
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
  isS3Configured,
  uploadToS3,
  downloadFromS3,
  streamFromS3,
  deleteFromS3,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
};
