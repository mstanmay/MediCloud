import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/database';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { recordAuditLog } from '../services/auditService';
import {
  generateAvailableSlotsForDate,
  getTodayIstYmd,
  type AvailabilityRule,
  type TimeInterval,
} from '../../src/shared/clinicRules';

export const directoryRouter = Router();

// Public Doctor Directory (returns active doctors unless admin requests all)
directoryRouter.get('/doctors', (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const specialization =
    typeof req.query.specialization === 'string' ? req.query.specialization.trim() : '';
  const includeInactive = req.query.includeInactive === 'true';

  const rows = db
    .prepare(`
      SELECT
        d.id, d.user_id, u.full_name, u.email, u.phone, u.is_active,
        d.specialization, d.license_number, d.department, d.experience_years,
        d.consultation_fee, d.bio, d.avatar_url
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      ORDER BY u.full_name ASC
    `)
    .all() as Array<Record<string, unknown>>;

  const filtered = rows
    .filter((row) => {
      if (!includeInactive && row.is_active !== 1) return false;
      if (specialization && specialization !== 'ALL' && row.specialization !== specialization) {
        return false;
      }
      if (search) {
        const hay = `${row.full_name} ${row.specialization} ${row.department}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      isActive: row.is_active === 1,
      specialization: row.specialization,
      licenseNumber: row.license_number,
      department: row.department,
      experienceYears: row.experience_years,
      consultationFee: row.consultation_fee,
      bio: row.bio,
      avatarUrl: row.avatar_url,
    }));

  res.json({ doctors: filtered });
});

directoryRouter.get('/doctors/:id', (req, res) => {
  const doctor = db
    .prepare(`
      SELECT
        d.id, d.user_id, u.full_name, u.is_active,
        d.specialization, d.license_number, d.department, d.experience_years,
        d.consultation_fee, d.bio, d.avatar_url
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      WHERE d.id = ?
    `)
    .get(req.params.id) as Record<string, unknown> | undefined;

  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found.' });
    return;
  }

  const availability = db
    .prepare(`
      SELECT id, day_of_week, start_time, end_time, slot_duration_minutes, is_available
      FROM doctor_availability
      WHERE doctor_id = ?
      ORDER BY day_of_week ASC, start_time ASC
    `)
    .all(req.params.id)
    .map((a: Record<string, unknown>) => ({
      id: a.id,
      dayOfWeek: a.day_of_week,
      startTime: a.start_time,
      endTime: a.end_time,
      slotDurationMinutes: a.slot_duration_minutes,
      isAvailable: a.is_available === 1,
    }));

  res.json({
    doctor: {
      id: doctor.id,
      userId: doctor.user_id,
      fullName: doctor.full_name,
      isActive: doctor.is_active === 1,
      specialization: doctor.specialization,
      licenseNumber: doctor.license_number,
      department: doctor.department,
      experienceYears: doctor.experience_years,
      consultationFee: doctor.consultation_fee,
      bio: doctor.bio,
      avatarUrl: doctor.avatar_url,
    },
    availability,
  });
});

directoryRouter.get('/doctors/:id/slots', (req, res) => {
  const dateYmd =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : getTodayIstYmd();

  const doctor = db
    .prepare('SELECT id FROM doctors WHERE id = ?')
    .get(req.params.id);
  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found.' });
    return;
  }

  const rules = db
    .prepare(`
      SELECT day_of_week, start_time, end_time, slot_duration_minutes, is_available
      FROM doctor_availability
      WHERE doctor_id = ?
    `)
    .all(req.params.id)
    .map((r: Record<string, unknown>): AvailabilityRule => ({
      dayOfWeek: Number(r.day_of_week),
      startTime: String(r.start_time),
      endTime: String(r.end_time),
      slotDurationMinutes: Number(r.slot_duration_minutes),
      isAvailable: r.is_available === 1,
    }));

  const appts = db
    .prepare(`
      SELECT scheduled_start, scheduled_end, status
      FROM appointments
      WHERE doctor_id = ?
    `)
    .all(req.params.id)
    .map((a: Record<string, unknown>): TimeInterval => ({
      scheduledStart: String(a.scheduled_start),
      scheduledEnd: String(a.scheduled_end),
      status: a.status as TimeInterval['status'],
    }));

  const slots = generateAvailableSlotsForDate(dateYmd, rules, appts);
  res.json({ date: dateYmd, timezone: 'Asia/Kolkata', slots });
});

const createDoctorSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(100),
  phone: z.string().trim().max(32).optional().default(''),
  specialization: z.string().trim().min(2).max(100),
  department: z.string().trim().min(2).max(100),
  licenseNumber: z.string().trim().min(4).max(64),
  experienceYears: z.coerce.number().int().min(0).max(70).default(5),
  consultationFee: z.coerce.number().int().min(100).max(50000).default(900),
  bio: z.string().trim().max(1000).optional().default(''),
});

directoryRouter.post(
  '/doctors',
  requireAuth,
  requireRole('ADMIN'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = createDoctorSchema.parse(req.body);
      const email = input.email.toLowerCase();

      const dupEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (dupEmail) {
        res.status(409).json({ error: 'Email is already registered.' });
        return;
      }

      const dupLicense = db
        .prepare('SELECT id FROM doctors WHERE license_number = ?')
        .get(input.licenseNumber);
      if (dupLicense) {
        res.status(409).json({ error: 'Medical license number is already registered.' });
        return;
      }

      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const doctorId = `doc_${crypto.randomUUID().slice(0, 12)}`;
      const nowIso = new Date().toISOString();
      const passwordHash = await bcrypt.hash(input.password, 10);

      db.exec('BEGIN');
      try {
        db.prepare(`
          INSERT INTO users (id, email, password_hash, role, full_name, phone, is_active, created_at, updated_at)
          VALUES (?, ?, ?, 'DOCTOR', ?, ?, 1, ?, ?)
        `).run(userId, email, passwordHash, input.fullName, input.phone || null, nowIso, nowIso);

        db.prepare(`
          INSERT INTO doctors (id, user_id, specialization, license_number, department, experience_years, consultation_fee, bio, avatar_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          doctorId,
          userId,
          input.specialization,
          input.licenseNumber,
          input.department,
          input.experienceYears,
          input.consultationFee,
          input.bio || null,
          '/src/assets/images/doctor_cardiology_portrait_1795016749598.jpg',
          nowIso,
          nowIso,
        );

        const insAvail = db.prepare(`
          INSERT INTO doctor_availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available)
          VALUES (?, ?, ?, '09:30', '13:00', 30, 1)
        `);
        for (let day = 1; day <= 5; day++) {
          insAvail.run(`avail_${doctorId}_${day}`, doctorId, day);
        }

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'DOCTOR_ONBOARDED',
        resourceType: 'Doctor',
        resourceId: doctorId,
        metadata: { specialization: input.specialization, licenseNumber: input.licenseNumber },
        ipAddress: req.ip,
      });

      res.status(201).json({ doctorId, userId });
    } catch (err) {
      next(err);
    }
  },
);

const updateDoctorSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(32).optional(),
  specialization: z.string().trim().min(2).max(100).optional(),
  department: z.string().trim().min(2).max(100).optional(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  consultationFee: z.coerce.number().int().min(100).max(50000).optional(),
  bio: z.string().trim().max(1000).optional(),
});

directoryRouter.put(
  '/doctors/:id',
  requireAuth,
  requireRole('DOCTOR', 'ADMIN'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const doctor = db
        .prepare('SELECT id, user_id FROM doctors WHERE id = ?')
        .get(req.params.id) as { id: string; user_id: string } | undefined;
      if (!doctor) {
        res.status(404).json({ error: 'Doctor not found.' });
        return;
      }

      if (req.auth!.role === 'DOCTOR' && doctor.user_id !== req.auth!.userId) {
        res.status(403).json({ error: 'You can only update your own doctor profile.' });
        return;
      }

      const input = updateDoctorSchema.parse(req.body);
      const nowIso = new Date().toISOString();

      if (input.fullName !== undefined || input.phone !== undefined) {
        db.prepare(`
          UPDATE users SET
            full_name = COALESCE(?, full_name),
            phone = COALESCE(?, phone),
            updated_at = ?
          WHERE id = ?
        `).run(input.fullName ?? null, input.phone ?? null, nowIso, doctor.user_id);
      }

      db.prepare(`
        UPDATE doctors SET
          specialization = COALESCE(?, specialization),
          department = COALESCE(?, department),
          experience_years = COALESCE(?, experience_years),
          consultation_fee = COALESCE(?, consultation_fee),
          bio = COALESCE(?, bio),
          updated_at = ?
        WHERE id = ?
      `).run(
        input.specialization ?? null,
        input.department ?? null,
        input.experienceYears ?? null,
        input.consultationFee ?? null,
        input.bio ?? null,
        nowIso,
        doctor.id,
      );

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'DOCTOR_PROFILE_UPDATED',
        resourceType: 'Doctor',
        resourceId: doctor.id,
        ipAddress: req.ip,
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const availabilityListSchema = z.object({
  rules: z.array(
    z.object({
      dayOfWeek: z.coerce.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      slotDurationMinutes: z.coerce.number().int().min(10).max(120),
      isAvailable: z.boolean(),
    }),
  ),
});

directoryRouter.put(
  '/doctors/:id/availability',
  requireAuth,
  requireRole('DOCTOR', 'ADMIN'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const doctor = db
        .prepare('SELECT id, user_id FROM doctors WHERE id = ?')
        .get(req.params.id) as { id: string; user_id: string } | undefined;
      if (!doctor) {
        res.status(404).json({ error: 'Doctor not found.' });
        return;
      }

      if (req.auth!.role === 'DOCTOR' && doctor.user_id !== req.auth!.userId) {
        res.status(403).json({ error: 'Cannot modify another doctor schedule.' });
        return;
      }

      const { rules } = availabilityListSchema.parse(req.body);
      for (const r of rules) {
        if (r.startTime >= r.endTime) {
          res.status(400).json({ error: `Invalid time range ${r.startTime} - ${r.endTime}.` });
          return;
        }
      }

      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM doctor_availability WHERE doctor_id = ?').run(doctor.id);
        const ins = db.prepare(`
          INSERT INTO doctor_availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of rules) {
          ins.run(
            `avail_${crypto.randomUUID().slice(0, 10)}`,
            doctor.id,
            r.dayOfWeek,
            r.startTime,
            r.endTime,
            r.slotDurationMinutes,
            r.isAvailable ? 1 : 0,
          );
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      recordAuditLog({
        actorUserId: req.auth!.userId,
        action: 'DOCTOR_AVAILABILITY_UPDATED',
        resourceType: 'Doctor',
        resourceId: doctor.id,
        metadata: { ruleCount: rules.length },
        ipAddress: req.ip,
      });

      res.json({ ok: true, count: rules.length });
    } catch (err) {
      next(err);
    }
  },
);

// Patients list (Admin sees all; Doctor sees ONLY authorized patients with appointments or active record share)
directoryRouter.get(
  '/patients',
  requireAuth,
  requireRole('DOCTOR', 'ADMIN'),
  (req: AuthenticatedRequest, res) => {
    if (req.auth!.role === 'ADMIN') {
      const rows = db
        .prepare(`
          SELECT p.id, p.user_id, u.full_name, u.email, u.phone, u.is_active,
                 p.date_of_birth, p.gender, p.blood_group, p.allergies, p.emergency_contact, p.address
          FROM patients p
          JOIN users u ON u.id = p.user_id
          ORDER BY u.full_name ASC
        `)
        .all();
      res.json({ patients: rows });
      return;
    }

    const doc = db
      .prepare('SELECT id FROM doctors WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Doctor profile not found.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const rows = db
      .prepare(`
        SELECT DISTINCT p.id, p.user_id, u.full_name, u.email, u.phone, u.is_active,
                        p.date_of_birth, p.gender, p.blood_group, p.allergies, p.emergency_contact, p.address
        FROM patients p
        JOIN users u ON u.id = p.user_id
        WHERE EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.patient_id = p.id AND a.doctor_id = ?
        )
        OR EXISTS (
          SELECT 1 FROM record_sharing_permissions s
          WHERE s.patient_id = p.id AND s.doctor_id = ? AND s.is_active = 1 AND s.revoked_at IS NULL AND s.expires_at > ?
        )
        ORDER BY u.full_name ASC
      `)
      .all(doc.id, doc.id, nowIso);

    res.json({ patients: rows });
  },
);

directoryRouter.get('/patients/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const patient = db
    .prepare(`
      SELECT p.*, u.full_name, u.email, u.phone, u.is_active
      FROM patients p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
    `)
    .get(req.params.id) as Record<string, unknown> | undefined;

  if (!patient) {
    res.status(404).json({ error: 'Patient not found.' });
    return;
  }

  if (req.auth!.role === 'PATIENT' && patient.user_id !== req.auth!.userId) {
    res.status(403).json({ error: 'Forbidden: cannot access another patient profile.' });
    return;
  }

  if (req.auth!.role === 'DOCTOR') {
    const doc = db
      .prepare('SELECT id FROM doctors WHERE user_id = ?')
      .get(req.auth!.userId) as { id: string } | undefined;
    const nowIso = new Date().toISOString();
    const hasRelationship =
      doc &&
      (db
        .prepare('SELECT 1 FROM appointments WHERE patient_id = ? AND doctor_id = ?')
        .get(req.params.id, doc.id) ||
        db
          .prepare(
            'SELECT 1 FROM record_sharing_permissions WHERE patient_id = ? AND doctor_id = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > ?',
          )
          .get(req.params.id, doc.id, nowIso));
    if (!hasRelationship) {
      res.status(403).json({ error: 'Forbidden: you are not authorized for this patient.' });
      return;
    }
  }

  res.json({ patient });
});

const updatePatientSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(32).optional(),
  dateOfBirth: z.string().trim().max(20).optional(),
  gender: z.string().trim().max(30).optional(),
  bloodGroup: z.string().trim().max(10).optional(),
  allergies: z.string().trim().max(500).optional(),
  emergencyContact: z.string().trim().max(160).optional(),
  address: z.string().trim().max(300).optional(),
});

directoryRouter.put('/patients/:id', requireAuth, (req: AuthenticatedRequest, res, next) => {
  try {
    const patient = db
      .prepare('SELECT id, user_id FROM patients WHERE id = ?')
      .get(req.params.id) as { id: string; user_id: string } | undefined;

    if (!patient) {
      res.status(404).json({ error: 'Patient not found.' });
      return;
    }

    if (req.auth!.role === 'PATIENT' && patient.user_id !== req.auth!.userId) {
      res.status(403).json({ error: 'Forbidden: cannot modify another patient profile.' });
      return;
    }
    if (req.auth!.role === 'DOCTOR') {
      res.status(403).json({ error: 'Doctors cannot alter patient personal demographics.' });
      return;
    }

    const input = updatePatientSchema.parse(req.body);
    const nowIso = new Date().toISOString();

    if (input.fullName !== undefined || input.phone !== undefined) {
      db.prepare(`
        UPDATE users SET
          full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          updated_at = ?
        WHERE id = ?
      `).run(input.fullName ?? null, input.phone ?? null, nowIso, patient.user_id);
    }

    db.prepare(`
      UPDATE patients SET
        date_of_birth = COALESCE(?, date_of_birth),
        gender = COALESCE(?, gender),
        blood_group = COALESCE(?, blood_group),
        allergies = COALESCE(?, allergies),
        emergency_contact = COALESCE(?, emergency_contact),
        address = COALESCE(?, address),
        updated_at = ?
      WHERE id = ?
    `).run(
      input.dateOfBirth ?? null,
      input.gender ?? null,
      input.bloodGroup ?? null,
      input.allergies ?? null,
      input.emergencyContact ?? null,
      input.address ?? null,
      nowIso,
      patient.id,
    );

    recordAuditLog({
      actorUserId: req.auth!.userId,
      action: 'PATIENT_PROFILE_UPDATED',
      resourceType: 'Patient',
      resourceId: patient.id,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
