import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { recordAuditLog } from '../services/auditService';
import { run24HourReminderSweep } from '../jobs/reminderWorker';

export const adminAndDashboardRouter = Router();

// Notifications
adminAndDashboardRouter.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT id, appointment_id, type, channel, subject, message, delivery_status, is_read, sent_at, created_at
      FROM notifications
      WHERE user_id = ? AND channel = 'IN_APP'
      ORDER BY created_at DESC
      LIMIT 40
    `)
    .all(req.auth!.userId);

  res.json({ notifications: rows });
});

adminAndDashboardRouter.patch(
  '/notifications/:id/read',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    const existing = db
      .prepare('SELECT id, user_id FROM notifications WHERE id = ?')
      .get(req.params.id) as { id: string; user_id: string } | undefined;
    if (!existing || existing.user_id !== req.auth!.userId) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(existing.id);
    res.json({ ok: true });
  },
);

adminAndDashboardRouter.post(
  '/notifications/read-all',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.auth!.userId);
    res.json({ ok: true });
  },
);

// Patient Dashboard
adminAndDashboardRouter.get(
  '/dashboard/patient',
  requireAuth,
  requireRole('PATIENT'),
  (req: AuthenticatedRequest, res) => {
    const patient = db
      .prepare(`
        SELECT p.*, u.full_name, u.email, u.phone
        FROM patients p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ?
      `)
      .get(req.auth!.userId) as Record<string, unknown> | undefined;

    if (!patient) {
      res.status(404).json({ error: 'Patient profile not found.' });
      return;
    }

    const appointments = db
      .prepare(`
        SELECT a.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users du ON du.id = d.user_id
        WHERE a.patient_id = ?
        ORDER BY a.scheduled_start DESC
      `)
      .all(String(patient.id));

    const recentRecords = db
      .prepare(`
        SELECT m.id, m.title, m.category, m.file_name, m.mime_type, m.file_size_bytes, m.created_at,
               du.full_name AS doctor_name
        FROM medical_records m
        JOIN doctors d ON d.id = m.uploaded_by_doctor_id
        JOIN users du ON du.id = d.user_id
        WHERE m.patient_id = ?
        ORDER BY m.created_at DESC
        LIMIT 5
      `)
      .all(String(patient.id));

    const unreadNotifications = (
      db
        .prepare(
          "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND channel = 'IN_APP' AND is_read = 0",
        )
        .get(req.auth!.userId) as { cnt: number }
    ).cnt;

    const activeShares = (
      db
        .prepare(
          'SELECT COUNT(*) AS cnt FROM record_sharing_permissions WHERE patient_id = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > ?',
        )
        .get(String(patient.id), new Date().toISOString()) as { cnt: number }
    ).cnt;

    res.json({
      profile: patient,
      appointments,
      recentRecords,
      unreadNotifications,
      activeShares,
    });
  },
);

// Doctor Dashboard
adminAndDashboardRouter.get(
  '/dashboard/doctor',
  requireAuth,
  requireRole('DOCTOR'),
  (req: AuthenticatedRequest, res) => {
    const doctor = db
      .prepare(`
        SELECT d.*, u.full_name, u.email, u.phone
        FROM doctors d JOIN users u ON u.id = d.user_id
        WHERE d.user_id = ?
      `)
      .get(req.auth!.userId) as Record<string, unknown> | undefined;

    if (!doctor) {
      res.status(404).json({ error: 'Doctor profile not found.' });
      return;
    }

    const appointments = db
      .prepare(`
        SELECT a.*, pu.full_name AS patient_name, p.blood_group AS patient_blood_group
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE a.doctor_id = ?
        ORDER BY a.scheduled_start ASC
      `)
      .all(String(doctor.id)) as Array<Record<string, unknown>>;

    const nowIso = new Date().toISOString();
    const authorizedPatientsCount = (
      db
        .prepare(`
          SELECT COUNT(DISTINCT p.id) AS cnt
          FROM patients p
          WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = ?)
             OR EXISTS (SELECT 1 FROM record_sharing_permissions s WHERE s.patient_id = p.id AND s.doctor_id = ? AND s.is_active = 1 AND s.revoked_at IS NULL AND s.expires_at > ?)
        `)
        .get(String(doctor.id), String(doctor.id), nowIso) as { cnt: number }
    ).cnt;

    const uploadedRecordsCount = (
      db
        .prepare('SELECT COUNT(*) AS cnt FROM medical_records WHERE uploaded_by_doctor_id = ?')
        .get(String(doctor.id)) as { cnt: number }
    ).cnt;

    res.json({
      profile: doctor,
      appointments,
      authorizedPatientsCount,
      uploadedRecordsCount,
    });
  },
);

// Admin Dashboard Analytics
adminAndDashboardRouter.get(
  '/dashboard/admin',
  requireAuth,
  requireRole('ADMIN'),
  (_req: AuthenticatedRequest, res) => {
    const totalPatients = (db.prepare('SELECT COUNT(*) AS cnt FROM patients').get() as { cnt: number }).cnt;
    const totalDoctors = (db.prepare('SELECT COUNT(*) AS cnt FROM doctors').get() as { cnt: number }).cnt;
    const totalAppointments = (db.prepare('SELECT COUNT(*) AS cnt FROM appointments').get() as { cnt: number }).cnt;
    const totalRecords = (db.prepare('SELECT COUNT(*) AS cnt FROM medical_records').get() as { cnt: number }).cnt;

    const statusCounts = db
      .prepare('SELECT status, COUNT(*) AS count FROM appointments GROUP BY status')
      .all() as Array<{ status: string; count: number }>;

    const byDepartment = db
      .prepare(`
        SELECT d.specialization, COUNT(a.id) AS count
        FROM doctors d
        LEFT JOIN appointments a ON a.doctor_id = d.id
        GROUP BY d.specialization
        ORDER BY count DESC
      `)
      .all();

    const emailLogs = db
      .prepare(`
        SELECT n.id, n.type, n.subject, n.delivery_status, n.sent_at, u.email AS recipient_email
        FROM notifications n
        JOIN users u ON u.id = n.user_id
        WHERE n.channel = 'EMAIL'
        ORDER BY n.created_at DESC
        LIMIT 15
      `)
      .all();

    res.json({
      summary: {
        totalPatients,
        totalDoctors,
        totalAppointments,
        totalRecords,
        statusBreakdown: statusCounts,
      },
      byDepartment,
      emailLogs,
    });
  },
);

// Admin User Management & Audit Logs
adminAndDashboardRouter.get(
  '/admin/users',
  requireAuth,
  requireRole('ADMIN'),
  (_req, res) => {
    const users = db
      .prepare(`
        SELECT u.id, u.email, u.role, u.full_name, u.phone, u.is_active, u.created_at,
               d.id AS doctor_id, d.specialization, d.license_number, d.department,
               p.id AS patient_id, p.blood_group
        FROM users u
        LEFT JOIN doctors d ON d.user_id = u.id
        LEFT JOIN patients p ON p.user_id = u.id
        ORDER BY u.created_at DESC
      `)
      .all();
    res.json({ users });
  },
);

const userStatusSchema = z.object({
  isActive: z.boolean(),
});

adminAndDashboardRouter.patch(
  '/admin/users/:id/status',
  requireAuth,
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const { isActive } = userStatusSchema.parse(req.body);
      if (req.params.id === req.auth!.userId && !isActive) {
        res.status(400).json({ error: 'Cannot deactivate your own active administrator account.' });
        return;
      }

      const target = db
        .prepare('SELECT id, role FROM users WHERE id = ?')
        .get(req.params.id) as { id: string; role: string } | undefined;
      if (!target) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(
        isActive ? 1 : 0,
        new Date().toISOString(),
        target.id,
      );

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        resourceType: 'User',
        resourceId: target.id,
        ipAddress: req.ip,
      });

      res.json({ ok: true, isActive });
    } catch (err) {
      next(err);
    }
  },
);

adminAndDashboardRouter.get(
  '/admin/audit-logs',
  requireAuth,
  requireRole('ADMIN'),
  (_req, res) => {
    const logs = db
      .prepare(`
        SELECT a.*, u.full_name AS actor_name, u.email AS actor_email, u.role AS actor_role
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC
        LIMIT 100
      `)
      .all();
    res.json({ logs });
  },
);

adminAndDashboardRouter.post(
  '/admin/run-reminders',
  requireAuth,
  requireRole('ADMIN'),
  async (_req, res, next) => {
    try {
      const result = await run24HourReminderSweep();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
