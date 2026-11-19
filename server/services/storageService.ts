import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env, isS3Configured } from '../config/env';
import { uploadsDir } from '../db/database';
import {
  ALLOWED_REPORT_MIME_TYPES,
  AllowedReportMimeType,
  MAX_REPORT_SIZE_BYTES,
  detectFileMimeFromBytes,
} from '../../src/shared/clinicRules';

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: env.awsRegion });
  }
  return s3Client;
}

export interface SignedUploadGrant {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  expiresInSeconds: number;
  provider: 'aws-s3' | 'local-vault';
}

export interface SignedDownloadGrant {
  downloadUrl: string;
  expiresInSeconds: number;
  provider: 'aws-s3' | 'local-vault';
}

export async function createPresignedUploadGrant(params: {
  patientId: string;
  doctorId: string;
  fileName: string;
  mimeType: AllowedReportMimeType;
  fileSizeBytes: number;
}): Promise<SignedUploadGrant> {
  if (!ALLOWED_REPORT_MIME_TYPES.includes(params.mimeType)) {
    throw new Error('Unsupported medical report file type. Allowed: PDF, JPEG, PNG.');
  }
  if (params.fileSizeBytes <= 0 || params.fileSizeBytes > MAX_REPORT_SIZE_BYTES) {
    throw new Error('File size exceeds maximum 10 MB limit.');
  }

  const ext =
    params.mimeType === 'application/pdf'
      ? 'pdf'
      : params.mimeType === 'image/png'
        ? 'png'
        : 'jpg';
  const safeKey = `records/${params.patientId}/${crypto.randomUUID()}.${ext}`;
  const expiresInSeconds = 300;

  if (isS3Configured()) {
    const command = new PutObjectCommand({
      Bucket: env.awsS3Bucket,
      Key: safeKey,
      ContentType: params.mimeType,
      ServerSideEncryption: 'AES256',
    });
    const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
    return {
      storageKey: safeKey,
      uploadUrl,
      method: 'PUT',
      expiresInSeconds,
      provider: 'aws-s3',
    };
  }

  const token = jwt.sign(
    {
      purpose: 'UPLOAD',
      storageKey: safeKey,
      patientId: params.patientId,
      doctorId: params.doctorId,
      mimeType: params.mimeType,
    },
    env.jwtSecret,
    { expiresIn: expiresInSeconds },
  );

  return {
    storageKey: safeKey,
    uploadUrl: `/api/medical-records/upload/${token}`,
    method: 'PUT',
    expiresInSeconds,
    provider: 'local-vault',
  };
}

export function saveValidatedObjectToLocalVault(
  storageKey: string,
  buffer: Buffer,
  expectedMime: AllowedReportMimeType,
): { sha256: string; actualMime: AllowedReportMimeType; byteLength: number } {
  if (buffer.length === 0 || buffer.length > MAX_REPORT_SIZE_BYTES) {
    throw new Error('Invalid file size (must be between 1 byte and 10 MB).');
  }
  const detectedMime = detectFileMimeFromBytes(new Uint8Array(buffer));
  if (!detectedMime || detectedMime !== expectedMime) {
    throw new Error(
      `File signature mismatch: declared ${expectedMime}, detected ${detectedMime || 'unknown/unsafe'}.`,
    );
  }

  const resolvedPath = path.resolve(uploadsDir, storageKey);
  if (!resolvedPath.startsWith(uploadsDir + path.sep)) {
    throw new Error('Invalid storage key path.');
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    sha256,
    actualMime: detectedMime,
    byteLength: buffer.length,
  };
}

export function verifyLocalVaultObject(storageKey: string): { exists: boolean; byteLength: number; sha256: string } {
  const resolvedPath = path.resolve(uploadsDir, storageKey);
  if (!resolvedPath.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolvedPath)) {
    return { exists: false, byteLength: 0, sha256: '' };
  }
  const buf = fs.readFileSync(resolvedPath);
  return {
    exists: true,
    byteLength: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

export async function createPresignedDownloadGrant(params: {
  recordId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  requestedByUserId: string;
}): Promise<SignedDownloadGrant> {
  const expiresInSeconds = 120;

  if (isS3Configured()) {
    const command = new GetObjectCommand({
      Bucket: env.awsS3Bucket,
      Key: params.storageKey,
      ResponseContentDisposition: `attachment; filename="${params.fileName.replace(/"/g, '')}"`,
    });
    const downloadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
    return {
      downloadUrl,
      expiresInSeconds,
      provider: 'aws-s3',
    };
  }

  const token = jwt.sign(
    {
      purpose: 'DOWNLOAD',
      recordId: params.recordId,
      storageKey: params.storageKey,
      fileName: params.fileName,
      mimeType: params.mimeType,
      requestedByUserId: params.requestedByUserId,
    },
    env.jwtSecret,
    { expiresIn: expiresInSeconds },
  );

  return {
    downloadUrl: `/api/medical-records/download/${token}`,
    expiresInSeconds,
    provider: 'local-vault',
  };
}

export function readLocalVaultObject(storageKey: string): Buffer {
  const resolvedPath = path.resolve(uploadsDir, storageKey);
  if (!resolvedPath.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolvedPath)) {
    throw new Error('Medical report object not found in private vault.');
  }
  return fs.readFileSync(resolvedPath);
}
