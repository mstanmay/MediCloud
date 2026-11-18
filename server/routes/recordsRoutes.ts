import express, { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../db/database';
import { env, isS3Configured } from '../config/env';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import {
  createPresignedDownloadGrant,
  createPresignedUploadGrant,
  readLocalVaultObject,
  saveValidatedObjectToLocalVault,
  verifyLocalVaultObject,
} from '../services/storageService';
import { dispatchNotification } from '../services/notificationService';
import { recordAuditLog } from '../services/auditService';
import {
  ALLOWED_REPORT_MIME_TYPES,
  MAX_REPORT_SIZE_BYTES,
  isSharingPermissionActive,
  type AllowedReportMimeType,
} from '../../src/shared/clinicRules';

export const recordsRouter = Router();

function isDoctorAuthorizedForPatient(doctorId: string, patientId: string): boolean {
  const appt = db
    .prepare('SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ?')
    .get(doctorId, patientId);
  if (appt) return true;

  const nowIso = new Date().toISOString();
  const share = db
    .prepare(
      'SELECT 1 FROM record_sharing_permissions WHERE doctor_id = ? AND patient_id = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > ?',
    )
    .get(doctorId, patientId, nowIso);
  return Boolean(share);
}

const uploadUrlSchema = z.object({
  patientId: z.string().min(1),
  fileName: z.string().trim().min(3).max(200),
  mimeType: z.enum(ALLOWED_REPORT_MIME_TYPES),
  fileSizeBytes: z.coerce.number().int().min(1).max(MAX_REPORT_SIZE_BYTES),
});

recordsRouter.post(
  '/medical-records/upload-url',
  requireAuth,
  requireRole('DOCTOR'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = uploadUrlSchema.parse(req.body);
      const doctor = db
        .prepare('SELECT id FROM doctors WHERE user_id = ?')
        .get(req.auth!.userId) as { id: string } | undefined;
      if (!doctor) {
        res.status(404).json({ error: 'Doctor profile not found.' });
        return;
      }

      const patient = db
        .prepare('SELECT id FROM patients WHERE id = ?')
        .get(input.patientId);
      if (!patient) {
        res.status(404).json({ error: 'Patient not found.' });
        return;
      }

      if (!isDoctorAuthorizedForPatient(doctor.id, input.patientId)) {
        res.status(403).json({
          error:
            'Forbidden: you may only upload reports for patients assigned to your appointments or sharing grants.',
        });
        return;
      }

      const grant = await createPresignedUploadGrant({
        patientId: input.patientId,
        doctorId: doctor.id,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
      });

      res.json(grant);
    } catch (err) {
      next(err);
    }
  },
);

// Presigned local vault PUT target (simulates direct-to-S3 PUT with signature & magic-byte validation)
recordsRouter.put(
  '/medical-records/upload/:token',
  express.raw({ type: '*/*', limit: '11mb' }),
  (req, res) => {
    try {
      const payload = jwt.verify(req.params.token, env.jwtSecret) as {
        purpose: string;
        storageKey: string;
        mimeType: AllowedReportMimeType;
      };
      if (payload.purpose !== 'UPLOAD') {
        res.status(403).json({ error: 'Invalid upload token.' });
        return;
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const result = saveValidatedObjectToLocalVault(
        payload.storageKey,
        buffer,
        payload.mimeType,
      );
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Upload validation failed.',
      });
    }
  },
);

const confirmUploadSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().optional().nullable(),
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  fileName: z.string().trim().min(3).max(200),
  mimeType: z.enum(ALLOWED_REPORT_MIME_TYPES),
  fileSizeBytes: z.coerce.number().int().min(1).max(MAX_REPORT_SIZE_BYTES),
  storageKey: z.string().min(8).max(260),
  notes: z.string().trim().max(1000).optional().default(''),
});

recordsRouter.post(
  '/medical-records/confirm-upload',
  requireAuth,
  requireRole('DOCTOR'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = confirmUploadSchema.parse(req.body);
      const doctor = db
        .prepare(
          'SELECT d.id, u.full_name FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?',
        )
        .get(req.auth!.userId) as { id: string; full_name: string } | undefined;
      if (!doctor) {
        res.status(404).json({ error: 'Doctor profile not found.' });
        return;
      }

      if (!isDoctorAuthorizedForPatient(doctor.id, input.patientId)) {
        res.status(403).json({ error: 'Forbidden: unauthorized patient.' });
        return;
      }

      const patient = db
        .prepare(
          'SELECT p.id, u.id AS user_id, u.email, u.full_name FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
        )
        .get(input.patientId) as
        | { id: string; user_id: string; email: string; full_name: string }
        | undefined;
      if (!patient) {
        res.status(404).json({ error: 'Patient not found.' });
        return;
      }

      let sha256 = 's3-sse-aes256-verified';
      let byteLength = input.fileSizeBytes;
      if (!isS3Configured()) {
        const verified = verifyLocalVaultObject(input.storageKey);
        if (!verified.exists) {
          res.status(400).json({
            error: 'Uploaded file object could not be verified in private storage.',
          });
          return;
        }
        sha256 = verified.sha256;
        byteLength = verified.byteLength;
      }

      const recordId = `rec_${crypto.randomUUID().slice(0, 12)}`;
      const nowIso = new Date().toISOString();

      db.prepare(`
        INSERT INTO medical_records (
          id, patient_id, uploaded_by_doctor_id, appointment_id, title, category,
          file_name, mime_type, file_size_bytes, storage_key, checksum_sha256, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        recordId,
        patient.id,
        doctor.id,
        input.appointmentId || null,
        input.title,
        input.category,
        input.fileName,
        input.mimeType,
        byteLength,
        input.storageKey,
        sha256,
        input.notes || null,
        nowIso,
      );

      await dispatchNotification({
        userId: patient.user_id,
        recipientEmail: patient.email,
        appointmentId: input.appointmentId || null,
        type: 'MEDICAL_RECORD_UPLOADED',
        subject: `New Medical Report — ${input.title}`,
        message: `${doctor.full_name} uploaded "${input.title}" (${input.category}) to your encrypted MediCloud records.`,
        sendEmail: true,
      });

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'MEDICAL_RECORD_UPLOADED',
        resourceType: 'MedicalRecord',
        resourceId: recordId,
        metadata: { patientId: patient.id, title: input.title, mimeType: input.mimeType },
        ipAddress: req.ip,
      });

      const created = db
        .prepare(`
          SELECT m.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization
          FROM medical_records m
          JOIN doctors d ON d.id = m.uploaded_by_doctor_id
          JOIN users du ON du.id = d.user_id
          WHERE m.id = ?
        `)
        .get(recordId);

      res.status(201).json({ record: created });
    } catch (err) {
      next(err);
    }
  },
);

recordsRouter.get('/medical-records', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.auth!.role === 'ADMIN') {
    // Least privilege: Admins cannot browse or download patient clinical documents
    res.status(403).json({
      error:
        'Least-privilege policy: administrators cannot access private patient medical documents.',
    });
    return;
  }

  if (req.auth!.role === 'PATIENT') {
    const patient = db
      .prepare('SELECT id FROM patients WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    if (!patient) {
      res.json({ records: [] });
      return;
    }
    const rows = db
      .prepare(`
        SELECT m.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization,
               pu.full_name AS patient_name
        FROM medical_records m
        JOIN doctors d ON d.id = m.uploaded_by_doctor_id
        JOIN users du ON du.id = d.user_id
        JOIN patients p ON p.id = m.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE m.patient_id = ?
        ORDER BY m.created_at DESC
      `)
      .all(patient.id);
    res.json({ records: rows });
    return;
  }

  // DOCTOR sees records they uploaded OR records explicitly shared with them by active consent
  const doctor = db
    .prepare('SELECT id FROM doctors WHERE user_id = ?')
    .get(req.auth!.userId) as { id: string } | undefined;
  if (!doctor) {
    res.json({ records: [] });
    return;
  }

  const nowIso = new Date().toISOString();
  const rows = db
    .prepare(`
      SELECT DISTINCT m.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization,
                      pu.full_name AS patient_name,
                      CASE WHEN m.uploaded_by_doctor_id = ? THEN 'UPLOADED_BY_YOU' ELSE 'SHARED_CONSENT' END AS access_source
      FROM medical_records m
      JOIN doctors d ON d.id = m.uploaded_by_doctor_id
      JOIN users du ON du.id = d.user_id
      JOIN patients p ON p.id = m.patient_id
      JOIN users pu ON pu.id = p.user_id
      WHERE m.uploaded_by_doctor_id = ?
         OR EXISTS (
           SELECT 1 FROM record_sharing_permissions s
           WHERE s.record_id = m.id
             AND s.doctor_id = ?
             AND s.is_active = 1
             AND s.revoked_at IS NULL
             AND s.expires_at > ?
         )
      ORDER BY m.created_at DESC
    `)
    .all(doctor.id, doctor.id, doctor.id, nowIso);

  res.json({ records: rows });
});

recordsRouter.get(
  '/medical-records/:id/download-url',
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.auth!.role === 'ADMIN') {
        res.status(403).json({
          error: 'Least-privilege policy: administrators cannot download private medical reports.',
        });
        return;
      }

      const record = db
        .prepare(`
          SELECT m.*, p.user_id AS patient_user_id
          FROM medical_records m
          JOIN patients p ON p.id = m.patient_id
          WHERE m.id = ?
        `)
        .get(req.params.id) as
        | {
            id: string;
            patient_id: string;
            patient_user_id: string;
            uploaded_by_doctor_id: string;
            file_name: string;
            mime_type: string;
            storage_key: string;
          }
        | undefined;

      if (!record) {
        res.status(404).json({ error: 'Medical record not found.' });
        return;
      }

      let authorized = false;
      if (req.auth!.role === 'PATIENT') {
        authorized = record.patient_user_id === req.auth!.userId;
      } else if (req.auth!.role === 'DOCTOR') {
        const doctor = db
          .prepare('SELECT id FROM doctors WHERE user_id = ?')
          .get(req.auth!.userId) as { id: string } | undefined;
        if (doctor) {
          if (record.uploaded_by_doctor_id === doctor.id) {
            authorized = true;
          } else {
            const shares = db
              .prepare(
                'SELECT is_active, revoked_at, expires_at FROM record_sharing_permissions WHERE record_id = ? AND doctor_id = ?',
              )
              .all(record.id, doctor.id) as Array<{
              is_active: number;
              revoked_at: string | null;
              expires_at: string;
            }>;
            authorized = shares.some((s) =>
              isSharingPermissionActive({
                isActive: s.is_active === 1,
                revokedAt: s.revoked_at,
                expiresAt: s.expires_at,
              }),
            );
          }
        }
      }

      if (!authorized) {
        recordAuditLog({
          actorUserId: req.auth!.userId,
          action: 'MEDICAL_RECORD_ACCESS_DENIED',
          resourceType: 'MedicalRecord',
          resourceId: record.id,
          ipAddress: req.ip,
        });
        res.status(403).json({
          error: 'Forbidden: you do not have permission to access this medical record.',
        });
        return;
      }

      const grant = await createPresignedDownloadGrant({
        recordId: record.id,
        storageKey: record.storage_key,
        fileName: record.file_name,
        mimeType: record.mime_type,
        requestedByUserId: req.auth!.userId,
      });

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'MEDICAL_RECORD_DOWNLOAD_URL_ISSUED',
        resourceType: 'MedicalRecord',
        resourceId: record.id,
        metadata: { fileName: record.file_name, provider: grant.provider },
        ipAddress: req.ip,
      });

      res.json(grant);
    } catch (err) {
      next(err);
    }
  },
);

recordsRouter.get('/medical-records/download/:token', (req, res) => {
  try {
    const payload = jwt.verify(req.params.token, env.jwtSecret) as {
      purpose: string;
      storageKey: string;
      fileName: string;
      mimeType: string;
    };
    if (payload.purpose !== 'DOWNLOAD') {
      res.status(403).json({ error: 'Invalid download token.' });
      return;
    }

    const buf = readLocalVaultObject(payload.storageKey);
    res.setHeader('Content-Type', payload.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${payload.fileName.replace(/"/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch {
    res.status(403).json({ error: 'Download link has expired or is invalid.' });
  }
});

// Patient Medical Record Access History
recordsRouter.get(
  '/medical-records/:id/access-history',
  requireAuth,
  requireRole('PATIENT'),
  (req: AuthenticatedRequest, res) => {
    const patient = db
      .prepare('SELECT id FROM patients WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    const record = db
      .prepare('SELECT id, patient_id FROM medical_records WHERE id = ?')
      .get(req.params.id) as { id: string; patient_id: string } | undefined;

    if (!record || !patient || record.patient_id !== patient.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const logs = db
      .prepare(`
        SELECT a.id, a.action, a.created_at, a.metadata_json, u.full_name AS actor_name, u.role AS actor_role
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.resource_type = 'MedicalRecord' AND a.resource_id = ?
        ORDER BY a.created_at DESC
        LIMIT 50
      `)
      .all(record.id);

    res.json({ history: logs });
  },
);

// Consent-based Medical Record Sharing
recordsRouter.get('/sharing', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.auth!.role === 'PATIENT') {
    const patient = db
      .prepare('SELECT id FROM patients WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    if (!patient) {
      res.json({ permissions: [] });
      return;
    }
    const rows = db
      .prepare(`
        SELECT s.*, m.title AS record_title, m.category AS record_category,
               du.full_name AS doctor_name, d.specialization AS doctor_specialization
        FROM record_sharing_permissions s
        JOIN medical_records m ON m.id = s.record_id
        JOIN doctors d ON d.id = s.doctor_id
        JOIN users du ON du.id = d.user_id
        WHERE s.patient_id = ?
        ORDER BY s.granted_at DESC
      `)
      .all(patient.id);
    res.json({ permissions: rows });
    return;
  }

  if (req.auth!.role === 'DOCTOR') {
    const doctor = db
      .prepare('SELECT id FROM doctors WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    if (!doctor) {
      res.json({ permissions: [] });
      return;
    }
    const rows = db
      .prepare(`
        SELECT s.*, m.title AS record_title, pu.full_name AS patient_name
        FROM record_sharing_permissions s
        JOIN medical_records m ON m.id = s.record_id
        JOIN patients p ON p.id = s.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE s.doctor_id = ? AND s.is_active = 1 AND s.revoked_at IS NULL
        ORDER BY s.granted_at DESC
      `)
      .all(doctor.id);
    res.json({ permissions: rows });
    return;
  }

  res.status(403).json({ error: 'Forbidden.' });
});

const createShareSchema = z.object({
  recordId: z.string().min(1),
  doctorId: z.string().min(1),
  durationDays: z.coerce.number().int().min(1).max(365).default(14),
});

recordsRouter.post(
  '/sharing',
  requireAuth,
  requireRole('PATIENT'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createShareSchema.parse(req.body);
      const patient = db
        .prepare('SELECT id FROM patients WHERE user_id = ?')
        .get(req.auth!.userId) as { id: string } | undefined;
      if (!patient) {
        res.status(404).json({ error: 'Patient profile not found.' });
        return;
      }

      const record = db
        .prepare('SELECT id, patient_id, title FROM medical_records WHERE id = ?')
        .get(input.recordId) as { id: string; patient_id: string; title: string } | undefined;
      if (!record || record.patient_id !== patient.id) {
        res.status(403).json({ error: 'You can only share your own medical records.' });
        return;
      }

      const doctor = db
        .prepare(
          'SELECT d.id, u.id AS user_id, u.full_name, u.email FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.id = ? AND u.is_active = 1',
        )
        .get(input.doctorId) as
        | { id: string; user_id: string; full_name: string; email: string }
        | undefined;
      if (!doctor) {
        res.status(404).json({ error: 'Selected doctor not found.' });
        return;
      }

      const id = `share_${crypto.randomUUID().slice(0, 12)}`;
      const now = new Date();
      const nowIso = now.toISOString();
      const expiresIso = new Date(
        now.getTime() + input.durationDays * 24 * 3600 * 1000,
      ).toISOString();

      db.prepare(`
        INSERT INTO record_sharing_permissions (id, record_id, patient_id, doctor_id, granted_at, expires_at, revoked_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
      `).run(id, record.id, patient.id, doctor.id, nowIso, expiresIso);

      await dispatchNotification({
        userId: doctor.user_id,
        recipientEmail: doctor.email,
        type: 'RECORD_SHARED',
        subject: `Medical Record Shared — ${record.title}`,
        message: `A patient granted you ${input.durationDays}-day access to "${record.title}".`,
        sendEmail: false,
      });

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'RECORD_CONSENT_GRANTED',
        resourceType: 'RecordSharingPermission',
        resourceId: id,
        metadata: { recordId: record.id, doctorId: doctor.id, expiresAt: expiresIso },
        ipAddress: req.ip,
      });

      res.status(201).json({ id, expiresAt: expiresIso });
    } catch (err) {
      next(err);
    }
  },
);

recordsRouter.patch(
  '/sharing/:id/revoke',
  requireAuth,
  requireRole('PATIENT'),
  (req: AuthenticatedRequest, res) => {
    const patient = db
      .prepare('SELECT id FROM patients WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    const perm = db
      .prepare('SELECT id, patient_id, record_id, doctor_id FROM record_sharing_permissions WHERE id = ?')
      .get(req.params.id) as
      | { id: string; patient_id: string; record_id: string; doctor_id: string }
      | undefined;

    if (!perm || !patient || perm.patient_id !== patient.id) {
      res.status(403).json({ error: 'Forbidden: cannot revoke this consent grant.' });
      return;
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE record_sharing_permissions
      SET is_active = 0, revoked_at = ?
      WHERE id = ?
    `).run(nowIso, perm.id);

    recordAuditLog({
      actorUserId: req.auth!.userId,
      action: 'RECORD_CONSENT_REVOKED',
      resourceType: 'RecordSharingPermission',
      resourceId: perm.id,
      metadata: { recordId: perm.record_id, doctorId: perm.doctor_id },
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  },
);
