import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/database';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { dispatchNotification } from '../services/notificationService';
import { recordAuditLog } from '../services/auditService';
import {
  canTransitionAppointmentStatus,
  formatIstDateTime,
  hasAppointmentOverlap,
  type AppointmentStatus,
  type TimeInterval,
} from '../../src/shared/clinicRules';

export const appointmentRouter = Router();

const createAppointmentSchema = z.object({
  doctorId: z.string().min(1),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  reason: z.string().trim().min(3, 'Please provide a consultation reason').max(500),
});

const statusUpdateSchema = z.object({
  status: z.enum([
    'APPROVED',
    'REJECTED',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ]),
  consultationNotes: z.string().trim().max(2000).optional(),
});

const rescheduleSchema = z.object({
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
});

function selectAppointmentsBase(whereClause: string, params: unknown[]) {
  return db
    .prepare(`
      SELECT
        a.*,
        pu.full_name AS patient_name,
        pu.email AS patient_email,
        pu.id AS patient_user_id,
        p.blood_group AS patient_blood_group,
        du.full_name AS doctor_name,
        du.email AS doctor_email,
        du.id AS doctor_user_id,
        d.specialization AS doctor_specialization,
        d.department AS doctor_department
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN users pu ON pu.id = p.user_id
      JOIN doctors d ON d.id = a.doctor_id
      JOIN users du ON du.id = d.user_id
      ${whereClause}
      ORDER BY a.scheduled_start DESC
    `)
    .all(...(params as string[]));
}

appointmentRouter.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const statusFilter =
    typeof req.query.status === 'string' && req.query.status !== 'ALL'
      ? req.query.status
      : null;

  let rows: unknown[] = [];

  if (req.auth!.role === 'PATIENT') {
    const patient = db
      .prepare('SELECT id FROM patients WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    if (!patient) {
      res.json({ appointments: [] });
      return;
    }
    rows = statusFilter
      ? selectAppointmentsBase('WHERE a.patient_id = ? AND a.status = ?', [
          patient.id,
          statusFilter,
        ])
      : selectAppointmentsBase('WHERE a.patient_id = ?', [patient.id]);
  } else if (req.auth!.role === 'DOCTOR') {
    const doctor = db
      .prepare('SELECT id FROM doctors WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    if (!doctor) {
      res.json({ appointments: [] });
      return;
    }
    rows = statusFilter
      ? selectAppointmentsBase('WHERE a.doctor_id = ? AND a.status = ?', [
          doctor.id,
          statusFilter,
        ])
      : selectAppointmentsBase('WHERE a.doctor_id = ?', [doctor.id]);
  } else {
    rows = statusFilter
      ? selectAppointmentsBase('WHERE a.status = ?', [statusFilter])
      : selectAppointmentsBase('', []);
  }

  res.json({ appointments: rows });
});

appointmentRouter.get('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = selectAppointmentsBase('WHERE a.id = ?', [req.params.id]) as Array<
    Record<string, unknown>
  >;
  const appt = rows[0];
  if (!appt) {
    res.status(404).json({ error: 'Appointment not found.' });
    return;
  }

  if (
    req.auth!.role === 'PATIENT' &&
    appt.patient_user_id !== req.auth!.userId
  ) {
    res.status(403).json({ error: 'Forbidden: appointment belongs to another patient.' });
    return;
  }
  if (
    req.auth!.role === 'DOCTOR' &&
    appt.doctor_user_id !== req.auth!.userId
  ) {
    res.status(403).json({ error: 'Forbidden: appointment belongs to another doctor.' });
    return;
  }

  res.json({ appointment: appt });
});

appointmentRouter.post(
  '/',
  requireAuth,
  requireRole('PATIENT'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createAppointmentSchema.parse(req.body);

      const patient = db
        .prepare(`
          SELECT p.id, u.full_name, u.email
          FROM patients p JOIN users u ON u.id = p.user_id
          WHERE p.user_id = ?
        `)
        .get(req.auth!.userId) as
        | { id: string; full_name: string; email: string }
        | undefined;
      if (!patient) {
        res.status(404).json({ error: 'Patient profile not found.' });
        return;
      }

      const doctor = db
        .prepare(`
          SELECT d.id, u.id AS user_id, u.full_name, u.email, u.is_active, d.specialization
          FROM doctors d JOIN users u ON u.id = d.user_id
          WHERE d.id = ?
        `)
        .get(input.doctorId) as
        | {
            id: string;
            user_id: string;
            full_name: string;
            email: string;
            is_active: number;
            specialization: string;
          }
        | undefined;
      if (!doctor || doctor.is_active !== 1) {
        res.status(404).json({ error: 'Selected doctor is not currently available.' });
        return;
      }

      if (Date.parse(input.scheduledStart) <= Date.now()) {
        res.status(400).json({ error: 'Appointment must be scheduled in the future.' });
        return;
      }

      const apptId = `appt_${crypto.randomUUID().slice(0, 12)}`;
      const nowIso = new Date().toISOString();

      // Transactional conflict check to prevent double-booking races
      db.exec('BEGIN IMMEDIATE');
      try {
        const doctorIntervals = db
          .prepare('SELECT scheduled_start, scheduled_end, status FROM appointments WHERE doctor_id = ?')
          .all(doctor.id)
          .map((row: Record<string, unknown>): TimeInterval => ({
            scheduledStart: String(row.scheduled_start),
            scheduledEnd: String(row.scheduled_end),
            status: row.status as AppointmentStatus,
          }));

        if (hasAppointmentOverlap(input.scheduledStart, input.scheduledEnd, doctorIntervals)) {
          db.exec('ROLLBACK');
          res.status(409).json({
            error: 'This appointment slot overlaps an existing booking for the selected doctor.',
          });
          return;
        }

        const patientIntervals = db
          .prepare('SELECT scheduled_start, scheduled_end, status FROM appointments WHERE patient_id = ?')
          .all(patient.id)
          .map((row: Record<string, unknown>): TimeInterval => ({
            scheduledStart: String(row.scheduled_start),
            scheduledEnd: String(row.scheduled_end),
            status: row.status as AppointmentStatus,
          }));

        if (hasAppointmentOverlap(input.scheduledStart, input.scheduledEnd, patientIntervals)) {
          db.exec('ROLLBACK');
          res.status(409).json({
            error: 'You already have an overlapping appointment scheduled at this time.',
          });
          return;
        }

        db.prepare(`
          INSERT INTO appointments (id, patient_id, doctor_id, scheduled_start, scheduled_end, timezone, status, reason, consultation_notes, reminder_sent_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'Asia/Kolkata', 'REQUESTED', ?, NULL, NULL, ?, ?)
        `).run(
          apptId,
          patient.id,
          doctor.id,
          input.scheduledStart,
          input.scheduledEnd,
          input.reason,
          nowIso,
          nowIso,
        );

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const istFormatted = formatIstDateTime(input.scheduledStart);
      await dispatchNotification({
        userId: req.auth!.userId,
        recipientEmail: patient.email,
        appointmentId: apptId,
        type: 'APPOINTMENT_BOOKED',
        subject: `Appointment Requested — ${doctor.full_name}`,
        message: `Your ${doctor.specialization} appointment request with ${doctor.full_name} for ${istFormatted} (Asia/Kolkata) has been submitted.`,
        sendEmail: true,
      });

      await dispatchNotification({
        userId: doctor.user_id,
        recipientEmail: doctor.email,
        appointmentId: apptId,
        type: 'APPOINTMENT_REQUESTED',
        subject: `New Appointment Request — ${patient.full_name}`,
        message: `${patient.full_name} requested an appointment for ${istFormatted} (Asia/Kolkata). Reason: ${input.reason}`,
        sendEmail: true,
      });

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'APPOINTMENT_REQUESTED',
        resourceType: 'Appointment',
        resourceId: apptId,
        metadata: { doctorId: doctor.id, scheduledStart: input.scheduledStart },
        ipAddress: req.ip,
      });

      const created = selectAppointmentsBase('WHERE a.id = ?', [apptId])[0];
      res.status(201).json({ appointment: created });
    } catch (err) {
      next(err);
    }
  },
);

appointmentRouter.patch(
  '/:id/status',
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = statusUpdateSchema.parse(req.body);
      const appt = selectAppointmentsBase('WHERE a.id = ?', [req.params.id])[0] as
        | Record<string, unknown>
        | undefined;
      if (!appt) {
        res.status(404).json({ error: 'Appointment not found.' });
        return;
      }

      if (
        req.auth!.role === 'PATIENT' &&
        appt.patient_user_id !== req.auth!.userId
      ) {
        res.status(403).json({ error: 'Forbidden: cannot update another patient appointment.' });
        return;
      }
      if (
        req.auth!.role === 'DOCTOR' &&
        appt.doctor_user_id !== req.auth!.userId
      ) {
        res.status(403).json({ error: 'Forbidden: appointment is assigned to another doctor.' });
        return;
      }

      const currentStatus = appt.status as AppointmentStatus;
      if (
        !canTransitionAppointmentStatus(
          currentStatus,
          input.status,
          req.auth!.role,
        )
      ) {
        res.status(400).json({
          error: `Transition from ${currentStatus} to ${input.status} is not permitted for role ${req.auth!.role}.`,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      db.prepare(`
        UPDATE appointments
        SET status = ?,
            consultation_notes = COALESCE(?, consultation_notes),
            updated_at = ?
        WHERE id = ?
      `).run(
        input.status,
        input.consultationNotes ?? null,
        nowIso,
        req.params.id,
      );

      const istTime = formatIstDateTime(String(appt.scheduled_start));
      await dispatchNotification({
        userId: String(appt.patient_user_id),
        recipientEmail: String(appt.patient_email),
        appointmentId: req.params.id,
        type: `APPOINTMENT_${input.status}`,
        subject: `Appointment ${input.status} — ${String(appt.doctor_name)}`,
        message: `Your appointment with ${String(appt.doctor_name)} (${istTime} IST) is now ${input.status}.`,
        sendEmail: true,
      });

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: `APPOINTMENT_${input.status}`,
        resourceType: 'Appointment',
        resourceId: req.params.id,
        metadata: { from: currentStatus, to: input.status },
        ipAddress: req.ip,
      });

      const updated = selectAppointmentsBase('WHERE a.id = ?', [req.params.id])[0];
      res.json({ appointment: updated });
    } catch (err) {
      next(err);
    }
  },
);

appointmentRouter.patch(
  '/:id/reschedule',
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = rescheduleSchema.parse(req.body);
      const appt = selectAppointmentsBase('WHERE a.id = ?', [req.params.id])[0] as
        | Record<string, unknown>
        | undefined;
      if (!appt) {
        res.status(404).json({ error: 'Appointment not found.' });
        return;
      }

      if (
        req.auth!.role === 'PATIENT' &&
        appt.patient_user_id !== req.auth!.userId
      ) {
        res.status(403).json({ error: 'Forbidden: cannot reschedule another patient appointment.' });
        return;
      }
      if (
        req.auth!.role === 'DOCTOR' &&
        appt.doctor_user_id !== req.auth!.userId
      ) {
        res.status(403).json({ error: 'Forbidden: cannot reschedule another doctor appointment.' });
        return;
      }

      const currentStatus = appt.status as AppointmentStatus;
      if (['COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW'].includes(currentStatus)) {
        res.status(400).json({ error: `Cannot reschedule an appointment in ${currentStatus} state.` });
        return;
      }

      if (Date.parse(input.scheduledStart) <= Date.now()) {
        res.status(400).json({ error: 'Rescheduled slot must be in the future.' });
        return;
      }

      const nowIso = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const others = db
          .prepare(
            'SELECT scheduled_start, scheduled_end, status FROM appointments WHERE doctor_id = ? AND id != ?',
          )
          .all(String(appt.doctor_id), req.params.id)
          .map((row: Record<string, unknown>): TimeInterval => ({
            scheduledStart: String(row.scheduled_start),
            scheduledEnd: String(row.scheduled_end),
            status: row.status as AppointmentStatus,
          }));

        if (hasAppointmentOverlap(input.scheduledStart, input.scheduledEnd, others)) {
          db.exec('ROLLBACK');
          res.status(409).json({
            error: 'Requested reschedule slot conflicts with another booking.',
          });
          return;
        }

        db.prepare(`
          UPDATE appointments
          SET scheduled_start = ?,
              scheduled_end = ?,
              status = 'RESCHEDULED',
              reminder_sent_at = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(input.scheduledStart, input.scheduledEnd, nowIso, req.params.id);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const istTime = formatIstDateTime(input.scheduledStart);
      await dispatchNotification({
        userId: String(appt.doctor_user_id),
        recipientEmail: String(appt.doctor_email),
        appointmentId: req.params.id,
        type: 'APPOINTMENT_RESCHEDULED',
        subject: `Appointment Rescheduled — ${String(appt.patient_name)}`,
        message: `${String(appt.patient_name)} requested to reschedule to ${istTime} (Asia/Kolkata).`,
        sendEmail: true,
      });

      await dispatchNotification({
        userId: String(appt.patient_user_id),
        recipientEmail: String(appt.patient_email),
        appointmentId: req.params.id,
        type: 'APPOINTMENT_RESCHEDULED',
        subject: `Appointment Rescheduled — ${String(appt.doctor_name)}`,
        message: `Your appointment with ${String(appt.doctor_name)} has been moved to ${istTime} (Asia/Kolkata) and awaits doctor confirmation.`,
        sendEmail: true,
      });

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'APPOINTMENT_RESCHEDULED',
        resourceType: 'Appointment',
        resourceId: req.params.id,
        metadata: { newStart: input.scheduledStart },
        ipAddress: req.ip,
      });

      const updated = selectAppointmentsBase('WHERE a.id = ?', [req.params.id])[0];
      res.json({ appointment: updated });
    } catch (err) {
      next(err);
    }
  },
);

appointmentRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const appt = selectAppointmentsBase('WHERE a.id = ?', [req.params.id])[0] as
      | Record<string, unknown>
      | undefined;
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }

    if (req.auth!.role === 'PATIENT' && appt.patient_user_id !== req.auth!.userId) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const currentStatus = appt.status as AppointmentStatus;
    if (!canTransitionAppointmentStatus(currentStatus, 'CANCELLED', req.auth!.role)) {
      res.status(400).json({ error: `Appointment in ${currentStatus} state cannot be cancelled.` });
      return;
    }

    const nowIso = new Date().toISOString();
    db.prepare(`UPDATE appointments SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(
      nowIso,
      req.params.id,
    );

    recordAuditLog({
      actorUserId: req.auth!.userId,
      action: 'APPOINTMENT_CANCELLED',
      resourceType: 'Appointment',
      resourceId: req.params.id,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
