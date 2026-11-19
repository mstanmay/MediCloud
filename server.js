// server.ts
import express2 from "express";
import path3 from "node:path";
import fs3 from "node:fs";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// server/config/env.ts
import dotenv from "dotenv";
dotenv.config();
var env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3e3),
  tz: process.env.TZ || "Asia/Kolkata",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET || "medicloud-dev-signing-secret-change-in-production-2026",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  awsRegion: process.env.AWS_REGION || "",
  awsS3Bucket: process.env.AWS_S3_BUCKET || "",
  awsSesFromEmail: process.env.AWS_SES_FROM_EMAIL || ""
};
function isS3Configured() {
  return Boolean(
    env.awsRegion && env.awsS3Bucket && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );
}
function isSesConfigured() {
  return Boolean(
    env.awsRegion && env.awsSesFromEmail && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );
}

// server/db/database.ts
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
var DATA_DIR = path.resolve(process.cwd(), ".data");
var UPLOADS_DIR = path.join(DATA_DIR, "uploads");
var DB_PATH = path.join(DATA_DIR, "medicloud.sqlite");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
var uploadsDir = UPLOADS_DIR;
var db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('PATIENT', 'DOCTOR', 'ADMIN')),
    full_name TEXT NOT NULL,
    phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth TEXT,
    gender TEXT,
    blood_group TEXT,
    allergies TEXT,
    emergency_contact TEXT,
    address TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    specialization TEXT NOT NULL,
    license_number TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    experience_years INTEGER NOT NULL DEFAULT 5,
    consultation_fee INTEGER NOT NULL DEFAULT 800,
    bio TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctor_availability (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
    is_available INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    scheduled_start TEXT NOT NULL,
    scheduled_end TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    status TEXT NOT NULL CHECK(status IN ('REQUESTED', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW')),
    reason TEXT NOT NULL,
    consultation_notes TEXT,
    reminder_sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_doctor_start ON appointments(doctor_id, scheduled_start);
  CREATE INDEX IF NOT EXISTS idx_appointments_patient_start ON appointments(patient_id, scheduled_start);

  CREATE TABLE IF NOT EXISTS medical_records (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    uploaded_by_doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    checksum_sha256 TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_id, created_at);

  CREATE TABLE IF NOT EXISTS record_sharing_permissions (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    granted_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('IN_APP', 'EMAIL')),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'DELIVERED',
    is_read INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    metadata_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);
function createSamplePdfBuffer(title, patientName, summary) {
  const cleanTitle = title.replace(/[()\\]/g, "");
  const cleanPatient = patientName.replace(/[()\\]/g, "");
  const cleanSummary = summary.replace(/[()\\]/g, "");
  const stream = `BT /F1 14 Tf 50 740 Td (MediCloud Clinical Report: ${cleanTitle}) Tj 0 -24 Td /F1 11 Tf (Patient: ${cleanPatient}) Tj 0 -20 Td (Findings: ${cleanSummary}) Tj 0 -20 Td (Timezone: Asia/Kolkata | Synthetic Academic Record) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
${320 + Buffer.byteLength(stream)}
%%EOF`;
  return Buffer.from(pdf, "utf8");
}
function seedDatabaseIfEmpty() {
  const existingCount = db.prepare("SELECT COUNT(*) as cnt FROM users").get().cnt;
  if (existingCount > 0) return;
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const demoPasswordHash = bcrypt.hashSync("MediCloud@2026", 10);
  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, role, full_name, phone, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertPatient = db.prepare(`
    INSERT INTO patients (id, user_id, date_of_birth, gender, blood_group, allergies, emergency_contact, address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDoctor = db.prepare(`
    INSERT INTO doctors (id, user_id, specialization, license_number, department, experience_years, consultation_fee, bio, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAvail = db.prepare(`
    INSERT INTO doctor_availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available)
    VALUES (?, ?, ?, ?, ?, 30, 1)
  `);
  const insertAppt = db.prepare(`
    INSERT INTO appointments (id, patient_id, doctor_id, scheduled_start, scheduled_end, timezone, status, reason, consultation_notes, reminder_sent_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Asia/Kolkata', ?, ?, ?, ?, ?, ?)
  `);
  const insertRecord = db.prepare(`
    INSERT INTO medical_records (id, patient_id, uploaded_by_doctor_id, appointment_id, title, category, file_name, mime_type, file_size_bytes, storage_key, checksum_sha256, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?)
  `);
  const insertShare = db.prepare(`
    INSERT INTO record_sharing_permissions (id, record_id, patient_id, doctor_id, granted_at, expires_at, revoked_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
  `);
  const insertNotification = db.prepare(`
    INSERT INTO notifications (id, user_id, appointment_id, type, channel, subject, message, delivery_status, is_read, sent_at, created_at)
    VALUES (?, ?, ?, ?, 'IN_APP', ?, ?, 'DELIVERED', ?, ?, ?)
  `);
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, metadata_json, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '127.0.0.1', ?)
  `);
  insertUser.run("usr_admin_1", "admin@medicloud.demo", demoPasswordHash, "ADMIN", "Neha Kulkarni", "+91 98200 11220", nowIso, nowIso);
  insertUser.run("usr_pat_1", "arjun.mehta@medicloud.demo", demoPasswordHash, "PATIENT", "Arjun Mehta", "+91 98111 45001", nowIso, nowIso);
  insertPatient.run(
    "pat_1",
    "usr_pat_1",
    "1993-04-18",
    "Male",
    "O+",
    "Penicillin (mild rash)",
    "Priya Mehta (+91 98111 45002)",
    "42 Indiranagar 12th Main, Bengaluru 560038",
    nowIso,
    nowIso
  );
  insertUser.run("usr_pat_2", "ananya.iyer@medicloud.demo", demoPasswordHash, "PATIENT", "Ananya Iyer", "+91 98450 22910", nowIso, nowIso);
  insertPatient.run(
    "pat_2",
    "usr_pat_2",
    "1988-09-25",
    "Female",
    "A+",
    "None known",
    "Karthik Iyer (+91 98450 22911)",
    "18 Besant Nagar Avenue, Chennai 600090",
    nowIso,
    nowIso
  );
  insertUser.run("usr_doc_1", "dr.kavya.sharma@medicloud.demo", demoPasswordHash, "DOCTOR", "Dr. Kavya Sharma", "+91 99001 30001", nowIso, nowIso);
  insertDoctor.run(
    "doc_1",
    "usr_doc_1",
    "Cardiology",
    "MCI-KAR-48219",
    "Cardiovascular Medicine",
    12,
    1200,
    "Preventive cardiology, hypertension telemetry, and non-invasive cardiac diagnostics.",
    "/src/assets/images/doctor_cardiology_portrait_1795016749598.jpg",
    nowIso,
    nowIso
  );
  insertUser.run("usr_doc_2", "dr.vikram.rao@medicloud.demo", demoPasswordHash, "DOCTOR", "Dr. Vikram Rao", "+91 99001 30002", nowIso, nowIso);
  insertDoctor.run(
    "doc_2",
    "usr_doc_2",
    "Neurology",
    "MCI-DEL-63902",
    "Neurosciences",
    14,
    1400,
    "Headache disorders, ambulatory EEG review, and chronic migraine management.",
    "/src/assets/images/doctor_neurology_portrait_1795016749455.jpg",
    nowIso,
    nowIso
  );
  insertUser.run("usr_doc_3", "dr.meera.nair@medicloud.demo", demoPasswordHash, "DOCTOR", "Dr. Meera Nair", "+91 99001 30003", nowIso, nowIso);
  insertDoctor.run(
    "doc_3",
    "usr_doc_3",
    "General Medicine",
    "MCI-KER-71204",
    "Internal & Preventive Medicine",
    9,
    800,
    "Comprehensive primary care, metabolic screening, and longitudinal wellness monitoring.",
    "/src/assets/images/doctor_pediatrics_portrait_1795016750656.jpg",
    nowIso,
    nowIso
  );
  for (const docId of ["doc_1", "doc_2", "doc_3"]) {
    for (let day = 1; day <= 6; day++) {
      insertAvail.run(`avail_${docId}_${day}_am`, docId, day, "09:30", "13:00");
      insertAvail.run(`avail_${docId}_${day}_pm`, docId, day, "14:30", "17:30");
    }
  }
  insertAvail.run("avail_doc_3_0_am", "doc_3", 0, "10:00", "12:30");
  const pastStart = new Date(now.getTime() - 7 * 24 * 3600 * 1e3);
  pastStart.setUTCHours(4, 30, 0, 0);
  const pastEnd = new Date(pastStart.getTime() + 30 * 60 * 1e3);
  const upcoming1Start = new Date(now.getTime() + 24 * 3600 * 1e3);
  upcoming1Start.setUTCHours(5, 0, 0, 0);
  if (upcoming1Start.getTime() <= now.getTime()) {
    upcoming1Start.setUTCDate(upcoming1Start.getUTCDate() + 1);
  }
  const upcoming1End = new Date(upcoming1Start.getTime() + 30 * 60 * 1e3);
  const upcoming2Start = new Date(upcoming1Start.getTime() + 25 * 3600 * 1e3);
  const upcoming2End = new Date(upcoming2Start.getTime() + 30 * 60 * 1e3);
  const upcoming3Start = new Date(upcoming1Start.getTime() + 52 * 3600 * 1e3);
  upcoming3Start.setUTCHours(9, 30, 0, 0);
  const upcoming3End = new Date(upcoming3Start.getTime() + 30 * 60 * 1e3);
  insertAppt.run(
    "appt_1",
    "pat_1",
    "doc_1",
    pastStart.toISOString(),
    pastEnd.toISOString(),
    "COMPLETED",
    "Annual ECG & blood pressure baseline evaluation",
    "Sinus rhythm normal. Continue low-sodium diet and quarterly home BP log.",
    pastStart.toISOString(),
    nowIso,
    nowIso
  );
  insertAppt.run(
    "appt_2",
    "pat_1",
    "doc_1",
    upcoming1Start.toISOString(),
    upcoming1End.toISOString(),
    "APPROVED",
    "Follow-up lipid panel & resting heart rate review",
    null,
    null,
    // Eligible for 24h reminder worker!
    nowIso,
    nowIso
  );
  insertAppt.run(
    "appt_3",
    "pat_1",
    "doc_2",
    upcoming2Start.toISOString(),
    upcoming2End.toISOString(),
    "REQUESTED",
    "Recurring tension headache consultation",
    null,
    null,
    nowIso,
    nowIso
  );
  insertAppt.run(
    "appt_4",
    "pat_2",
    "doc_3",
    upcoming3Start.toISOString(),
    upcoming3End.toISOString(),
    "APPROVED",
    "Quarterly HbA1c and thyroid profile follow-up",
    null,
    null,
    nowIso,
    nowIso
  );
  const rec1Key = "records/pat_1/ecg_baseline_2026.pdf";
  const rec1Buf = createSamplePdfBuffer(
    "12-Lead ECG & Lipid Panel",
    "Arjun Mehta",
    "Normal sinus rhythm at 68 bpm. Total cholesterol 174 mg/dL, LDL 96 mg/dL."
  );
  fs.mkdirSync(path.dirname(path.join(UPLOADS_DIR, rec1Key)), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, rec1Key), rec1Buf);
  const rec1Sha = crypto.createHash("sha256").update(rec1Buf).digest("hex");
  insertRecord.run(
    "rec_1",
    "pat_1",
    "doc_1",
    "appt_1",
    "12-Lead ECG & Lipid Profile",
    "Cardiology Lab",
    "arjun_ecg_lipid_2026.pdf",
    rec1Buf.length,
    rec1Key,
    rec1Sha,
    "Baseline cardiovascular assessment within reference range.",
    nowIso
  );
  const rec2Key = "records/pat_1/cbc_metabolic_2026.pdf";
  const rec2Buf = createSamplePdfBuffer(
    "Comprehensive Metabolic Panel",
    "Arjun Mehta",
    "Fasting glucose 92 mg/dL, Hemoglobin 14.8 g/dL, Vitamin D 34 ng/mL."
  );
  fs.writeFileSync(path.join(UPLOADS_DIR, rec2Key), rec2Buf);
  const rec2Sha = crypto.createHash("sha256").update(rec2Buf).digest("hex");
  insertRecord.run(
    "rec_2",
    "pat_1",
    "doc_3",
    null,
    "Annual Metabolic & CBC Panel",
    "Pathology",
    "arjun_metabolic_cbc_2026.pdf",
    rec2Buf.length,
    rec2Key,
    rec2Sha,
    "Routine preventive lab workup; all parameters nominal.",
    nowIso
  );
  const rec3Key = "records/pat_2/thyroid_hba1c_2026.pdf";
  const rec3Buf = createSamplePdfBuffer(
    "Thyroid & HbA1c Screening",
    "Ananya Iyer",
    "TSH 2.3 mIU/L, HbA1c 5.4%. Maintain current hydration and walking routine."
  );
  fs.mkdirSync(path.dirname(path.join(UPLOADS_DIR, rec3Key)), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, rec3Key), rec3Buf);
  const rec3Sha = crypto.createHash("sha256").update(rec3Buf).digest("hex");
  insertRecord.run(
    "rec_3",
    "pat_2",
    "doc_3",
    "appt_4",
    "Thyroid & HbA1c Screening",
    "Endocrinology Lab",
    "ananya_thyroid_hba1c_2026.pdf",
    rec3Buf.length,
    rec3Key,
    rec3Sha,
    "Glycemic and thyroid indices stable.",
    nowIso
  );
  const shareExpiry = new Date(now.getTime() + 14 * 24 * 3600 * 1e3).toISOString();
  insertShare.run("share_1", "rec_1", "pat_1", "doc_2", nowIso, shareExpiry);
  insertNotification.run(
    "notif_1",
    "usr_pat_1",
    "appt_2",
    "APPOINTMENT_APPROVED",
    "Appointment Approved \u2014 Dr. Kavya Sharma",
    "Your Cardiology follow-up has been approved for your selected Asia/Kolkata slot.",
    0,
    nowIso,
    nowIso
  );
  insertNotification.run(
    "notif_2",
    "usr_pat_1",
    null,
    "MEDICAL_RECORD_UPLOADED",
    "New Medical Report Available",
    'Dr. Kavya Sharma uploaded "12-Lead ECG & Lipid Profile" to your encrypted vault.',
    0,
    nowIso,
    nowIso
  );
  insertNotification.run(
    "notif_3",
    "usr_doc_2",
    "appt_3",
    "APPOINTMENT_REQUESTED",
    "New Appointment Request \u2014 Arjun Mehta",
    "Arjun Mehta requested a Neurology consultation. Review and approve or decline in your queue.",
    0,
    nowIso,
    nowIso
  );
  insertAudit.run(
    "aud_1",
    "usr_doc_1",
    "MEDICAL_RECORD_UPLOADED",
    "MedicalRecord",
    "rec_1",
    JSON.stringify({ patientId: "pat_1", title: "12-Lead ECG & Lipid Profile" }),
    nowIso
  );
  insertAudit.run(
    "aud_2",
    "usr_pat_1",
    "RECORD_CONSENT_GRANTED",
    "RecordSharingPermission",
    "share_1",
    JSON.stringify({ recordId: "rec_1", doctorId: "doc_2" }),
    nowIso
  );
}

// server/middleware/auth.ts
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
var AUTH_COOKIE_NAME = "medicloud_session";
function signSessionToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "12h" });
}
function setSessionCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    maxAge: 12 * 3600 * 1e3,
    path: "/"
  });
}
function clearSessionCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
}
function requireAuth(req, res, next) {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : void 0;
  const token = cookieToken || bearerToken;
  if (!token) {
    res.status(401).json({ error: "Authentication required. Please sign in." });
    return;
  }
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    const userRow = db.prepare("SELECT id, role, email, is_active FROM users WHERE id = ?").get(decoded.userId);
    if (!userRow || userRow.is_active !== 1) {
      res.status(401).json({ error: "Account is inactive or no longer valid." });
      return;
    }
    req.auth = {
      userId: userRow.id,
      role: userRow.role,
      email: userRow.email
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired authentication session." });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role permissions for this resource." });
      return;
    }
    next();
  };
}
function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed.",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }
  console.error("[API Error]", err);
  res.status(500).json({
    error: "An unexpected server error occurred. Please try again."
  });
}

// server/routes/authRoutes.ts
import { Router } from "express";
import crypto4 from "node:crypto";
import bcrypt2 from "bcryptjs";
import { z } from "zod";

// server/services/notificationService.ts
import crypto2 from "node:crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
var sesClient = null;
function getSesClient() {
  if (!sesClient) {
    sesClient = new SESClient({ region: env.awsRegion });
  }
  return sesClient;
}
async function dispatchNotification(params) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const inAppId = `notif_${crypto2.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO notifications (id, user_id, appointment_id, type, channel, subject, message, delivery_status, is_read, sent_at, created_at)
    VALUES (?, ?, ?, ?, 'IN_APP', ?, ?, 'DELIVERED', 0, ?, ?)
  `).run(
    inAppId,
    params.userId,
    params.appointmentId || null,
    params.type,
    params.subject,
    params.message,
    nowIso,
    nowIso
  );
  let emailStatus = "SKIPPED";
  if (params.sendEmail && params.recipientEmail) {
    const emailLogId = `notif_${crypto2.randomUUID().slice(0, 12)}`;
    if (isSesConfigured()) {
      try {
        await getSesClient().send(
          new SendEmailCommand({
            Source: env.awsSesFromEmail,
            Destination: { ToAddresses: [params.recipientEmail] },
            Message: {
              Subject: { Data: params.subject, Charset: "UTF-8" },
              Body: { Text: { Data: params.message, Charset: "UTF-8" } }
            }
          })
        );
        emailStatus = "SENT_VIA_AWS_SES";
      } catch (err) {
        console.error("[SES] Email dispatch failed, logged for retry:", err);
        emailStatus = "SES_RETRY_PENDING";
      }
    } else {
      emailStatus = "SES_SANDBOX_LOGGED";
    }
    db.prepare(`
      INSERT INTO notifications (id, user_id, appointment_id, type, channel, subject, message, delivery_status, is_read, sent_at, created_at)
      VALUES (?, ?, ?, ?, 'EMAIL', ?, ?, ?, 1, ?, ?)
    `).run(
      emailLogId,
      params.userId,
      params.appointmentId || null,
      params.type,
      params.subject,
      params.message,
      emailStatus,
      nowIso,
      nowIso
    );
  }
  return { inAppId, emailStatus };
}

// server/services/auditService.ts
import crypto3 from "node:crypto";
function recordAuditLog(params) {
  const id = `aud_${crypto3.randomUUID().slice(0, 12)}`;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, metadata_json, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.actorUserId,
    params.action,
    params.resourceType,
    params.resourceId,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.ipAddress || "unknown",
    nowIso
  );
}

// server/routes/authRoutes.ts
var authRouter = Router();
var registerSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  email: z.string().trim().email("Valid email address is required").max(160),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  phone: z.string().trim().max(32).optional().default(""),
  dateOfBirth: z.string().trim().max(20).optional().default(""),
  gender: z.string().trim().max(30).optional().default(""),
  bloodGroup: z.string().trim().max(10).optional().default(""),
  allergies: z.string().trim().max(500).optional().default(""),
  emergencyContact: z.string().trim().max(160).optional().default(""),
  address: z.string().trim().max(300).optional().default("")
});
var loginSchema = z.object({
  email: z.string().trim().email("Valid email address is required"),
  password: z.string().min(1, "Password is required")
});
function getFullUserSessionView(userId) {
  const user = db.prepare(
    "SELECT id, email, role, full_name, phone, is_active, created_at FROM users WHERE id = ?"
  ).get(userId);
  if (!user) return null;
  let patientProfile = null;
  let doctorProfile = null;
  if (user.role === "PATIENT") {
    patientProfile = db.prepare("SELECT * FROM patients WHERE user_id = ?").get(user.id);
  } else if (user.role === "DOCTOR") {
    doctorProfile = db.prepare("SELECT * FROM doctors WHERE user_id = ?").get(user.id);
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
    phone: user.phone || "",
    isActive: user.is_active === 1,
    createdAt: user.created_at,
    patientProfile,
    doctorProfile
  };
}
authRouter.post("/register", async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const normalizedEmail = input.email.toLowerCase();
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const userId = `usr_${crypto4.randomUUID().slice(0, 12)}`;
    const patientId = `pat_${crypto4.randomUUID().slice(0, 12)}`;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const passwordHash = await bcrypt2.hash(input.password, 10);
    db.exec("BEGIN");
    try {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, full_name, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 'PATIENT', ?, ?, 1, ?, ?)
      `).run(
        userId,
        normalizedEmail,
        passwordHash,
        input.fullName,
        input.phone || null,
        nowIso,
        nowIso
      );
      db.prepare(`
        INSERT INTO patients (id, user_id, date_of_birth, gender, blood_group, allergies, emergency_contact, address, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        patientId,
        userId,
        input.dateOfBirth || null,
        input.gender || null,
        input.bloodGroup || null,
        input.allergies || null,
        input.emergencyContact || null,
        input.address || null,
        nowIso,
        nowIso
      );
      db.exec("COMMIT");
    } catch (txErr) {
      db.exec("ROLLBACK");
      throw txErr;
    }
    await dispatchNotification({
      userId,
      recipientEmail: normalizedEmail,
      type: "REGISTRATION_WELCOME",
      subject: "Welcome to MediCloud \u2014 Patient Account Verified",
      message: `Hello ${input.fullName}, your MediCloud patient portal is active. You can now book appointments and manage encrypted medical reports.`,
      sendEmail: true
    });
    recordAuditLog({
      actorUserId: userId,
      action: "PATIENT_REGISTERED",
      resourceType: "User",
      resourceId: userId,
      ipAddress: req.ip
    });
    const token = signSessionToken({ userId, role: "PATIENT", email: normalizedEmail });
    setSessionCookie(res, token);
    res.status(201).json({
      user: getFullUserSessionView(userId),
      token
    });
  } catch (err) {
    next(err);
  }
});
authRouter.post("/login", async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const normalizedEmail = input.email.toLowerCase();
    const userRow = db.prepare("SELECT id, email, password_hash, role, is_active FROM users WHERE email = ?").get(normalizedEmail);
    if (!userRow) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    if (userRow.is_active !== 1) {
      res.status(403).json({
        error: "This account has been deactivated by an administrator."
      });
      return;
    }
    const passwordValid = await bcrypt2.compare(input.password, userRow.password_hash);
    if (!passwordValid) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    const token = signSessionToken({
      userId: userRow.id,
      role: userRow.role,
      email: userRow.email
    });
    setSessionCookie(res, token);
    recordAuditLog({
      actorUserId: userRow.id,
      action: "USER_LOGIN",
      resourceType: "User",
      resourceId: userRow.id,
      metadata: { role: userRow.role },
      ipAddress: req.ip
    });
    res.json({
      user: getFullUserSessionView(userRow.id),
      token
    });
  } catch (err) {
    next(err);
  }
});
authRouter.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
authRouter.get("/session", (req, res) => {
  const cookieToken = req.cookies?.medicloud_session;
  if (!cookieToken) {
    res.json({ user: null });
    return;
  }
  requireAuth(req, res, () => {
    const user = getFullUserSessionView(req.auth.userId);
    res.json({ user: user || null });
  });
});
authRouter.get("/me", requireAuth, (req, res) => {
  const user = getFullUserSessionView(req.auth.userId);
  if (!user) {
    res.status(404).json({ error: "User profile not found." });
    return;
  }
  res.json({ user });
});

// server/routes/directoryRoutes.ts
import { Router as Router2 } from "express";
import crypto5 from "node:crypto";
import bcrypt3 from "bcryptjs";
import { z as z2 } from "zod";

// src/shared/clinicRules.ts
var CLINIC_TIMEZONE = "Asia/Kolkata";
var IST_OFFSET_MS = 330 * 60 * 1e3;
var ALLOWED_REPORT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png"
];
var MAX_REPORT_SIZE_BYTES = 10 * 1024 * 1024;
var ACTIVE_OCCUPYING_STATUSES = /* @__PURE__ */ new Set([
  "REQUESTED",
  "APPROVED",
  "RESCHEDULED"
]);
function hasAppointmentOverlap(candidateStartIso, candidateEndIso, existingAppointments) {
  const startA = Date.parse(candidateStartIso);
  const endA = Date.parse(candidateEndIso);
  if (!Number.isFinite(startA) || !Number.isFinite(endA) || endA <= startA) {
    return true;
  }
  return existingAppointments.some((appt) => {
    if (!ACTIVE_OCCUPYING_STATUSES.has(appt.status)) {
      return false;
    }
    const startB = Date.parse(appt.scheduledStart);
    const endB = Date.parse(appt.scheduledEnd);
    return startA < endB && endA > startB;
  });
}
var ALLOWED_TRANSITIONS = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED", "RESCHEDULED"],
  APPROVED: ["COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"],
  RESCHEDULED: ["APPROVED", "REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  NO_SHOW: []
};
function canTransitionAppointmentStatus(from, to, actorRole) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return false;
  }
  if (actorRole === "PATIENT") {
    return to === "CANCELLED" || to === "RESCHEDULED";
  }
  if (actorRole === "DOCTOR") {
    return ["APPROVED", "REJECTED", "COMPLETED", "NO_SHOW"].includes(to);
  }
  return actorRole === "ADMIN";
}
function getIstDayOfWeek(dateYmd) {
  const [year, month, day] = dateYmd.split("-").map(Number);
  if (!year || !month || !day) return -1;
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return utcDate.getUTCDay();
}
function istDateTimeToIso(dateYmd, timeHm) {
  const parsed = /* @__PURE__ */ new Date(`${dateYmd}T${timeHm}:00+05:30`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid IST date/time: ${dateYmd} ${timeHm}`);
  }
  return parsed.toISOString();
}
function generateAvailableSlotsForDate(dateYmd, rules, existingAppointments, nowMs = Date.now()) {
  const dayOfWeek = getIstDayOfWeek(dateYmd);
  if (dayOfWeek < 0) return [];
  const matchingRules = rules.filter((r) => r.isAvailable && r.dayOfWeek === dayOfWeek);
  const slots = [];
  for (const rule of matchingRules) {
    const [startH, startM] = rule.startTime.split(":").map(Number);
    const [endH, endM] = rule.endTime.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const duration = Math.max(10, rule.slotDurationMinutes);
    for (let m = startMinutes; m + duration <= endMinutes; m += duration) {
      const sh = String(Math.floor(m / 60)).padStart(2, "0");
      const sm = String(m % 60).padStart(2, "0");
      const eh = String(Math.floor((m + duration) / 60)).padStart(2, "0");
      const em = String((m + duration) % 60).padStart(2, "0");
      const startIso = istDateTimeToIso(dateYmd, `${sh}:${sm}`);
      const endIso = istDateTimeToIso(dateYmd, `${eh}:${em}`);
      const startMs = Date.parse(startIso);
      if (startMs <= nowMs) {
        continue;
      }
      const isBooked = hasAppointmentOverlap(startIso, endIso, existingAppointments);
      slots.push({
        startIso,
        endIso,
        labelIst: `${sh}:${sm} \u2013 ${eh}:${em} IST`,
        isBooked
      });
    }
  }
  return slots.sort((a, b) => a.startIso.localeCompare(b.startIso));
}
function detectFileMimeFromBytes(bytes) {
  if (bytes.length < 4) return null;
  if (bytes.length >= 5 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45) {
    return "application/pdf";
  }
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    return "image/png";
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return "image/jpeg";
  }
  return null;
}
function isSharingPermissionActive(permission, nowMs = Date.now()) {
  if (!permission.isActive || permission.revokedAt) {
    return false;
  }
  const expiresMs = Date.parse(permission.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}
function formatIstDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: CLINIC_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);
}
function getTodayIstYmd(nowMs = Date.now()) {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// server/routes/directoryRoutes.ts
var directoryRouter = Router2();
directoryRouter.get("/doctors", (req, res) => {
  const search = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const specialization = typeof req.query.specialization === "string" ? req.query.specialization.trim() : "";
  const includeInactive = req.query.includeInactive === "true";
  const rows = db.prepare(`
      SELECT
        d.id, d.user_id, u.full_name, u.email, u.phone, u.is_active,
        d.specialization, d.license_number, d.department, d.experience_years,
        d.consultation_fee, d.bio, d.avatar_url
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      ORDER BY u.full_name ASC
    `).all();
  const filtered = rows.filter((row) => {
    if (!includeInactive && row.is_active !== 1) return false;
    if (specialization && specialization !== "ALL" && row.specialization !== specialization) {
      return false;
    }
    if (search) {
      const hay = `${row.full_name} ${row.specialization} ${row.department}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }).map((row) => ({
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
    avatarUrl: row.avatar_url
  }));
  res.json({ doctors: filtered });
});
directoryRouter.get("/doctors/:id", (req, res) => {
  const doctor = db.prepare(`
      SELECT
        d.id, d.user_id, u.full_name, u.is_active,
        d.specialization, d.license_number, d.department, d.experience_years,
        d.consultation_fee, d.bio, d.avatar_url
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      WHERE d.id = ?
    `).get(req.params.id);
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found." });
    return;
  }
  const availability = db.prepare(`
      SELECT id, day_of_week, start_time, end_time, slot_duration_minutes, is_available
      FROM doctor_availability
      WHERE doctor_id = ?
      ORDER BY day_of_week ASC, start_time ASC
    `).all(req.params.id).map((a) => ({
    id: a.id,
    dayOfWeek: a.day_of_week,
    startTime: a.start_time,
    endTime: a.end_time,
    slotDurationMinutes: a.slot_duration_minutes,
    isAvailable: a.is_available === 1
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
      avatarUrl: doctor.avatar_url
    },
    availability
  });
});
directoryRouter.get("/doctors/:id/slots", (req, res) => {
  const dateYmd = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : getTodayIstYmd();
  const doctor = db.prepare("SELECT id FROM doctors WHERE id = ?").get(req.params.id);
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found." });
    return;
  }
  const rules = db.prepare(`
      SELECT day_of_week, start_time, end_time, slot_duration_minutes, is_available
      FROM doctor_availability
      WHERE doctor_id = ?
    `).all(req.params.id).map((r) => ({
    dayOfWeek: Number(r.day_of_week),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    slotDurationMinutes: Number(r.slot_duration_minutes),
    isAvailable: r.is_available === 1
  }));
  const appts = db.prepare(`
      SELECT scheduled_start, scheduled_end, status
      FROM appointments
      WHERE doctor_id = ?
    `).all(req.params.id).map((a) => ({
    scheduledStart: String(a.scheduled_start),
    scheduledEnd: String(a.scheduled_end),
    status: a.status
  }));
  const slots = generateAvailableSlotsForDate(dateYmd, rules, appts);
  res.json({ date: dateYmd, timezone: "Asia/Kolkata", slots });
});
var createDoctorSchema = z2.object({
  fullName: z2.string().trim().min(2).max(120),
  email: z2.string().trim().email().max(160),
  password: z2.string().min(8).max(100),
  phone: z2.string().trim().max(32).optional().default(""),
  specialization: z2.string().trim().min(2).max(100),
  department: z2.string().trim().min(2).max(100),
  licenseNumber: z2.string().trim().min(4).max(64),
  experienceYears: z2.coerce.number().int().min(0).max(70).default(5),
  consultationFee: z2.coerce.number().int().min(100).max(5e4).default(900),
  bio: z2.string().trim().max(1e3).optional().default("")
});
directoryRouter.post(
  "/doctors",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const input = createDoctorSchema.parse(req.body);
      const email = input.email.toLowerCase();
      const dupEmail = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (dupEmail) {
        res.status(409).json({ error: "Email is already registered." });
        return;
      }
      const dupLicense = db.prepare("SELECT id FROM doctors WHERE license_number = ?").get(input.licenseNumber);
      if (dupLicense) {
        res.status(409).json({ error: "Medical license number is already registered." });
        return;
      }
      const userId = `usr_${crypto5.randomUUID().slice(0, 12)}`;
      const doctorId = `doc_${crypto5.randomUUID().slice(0, 12)}`;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const passwordHash = await bcrypt3.hash(input.password, 10);
      db.exec("BEGIN");
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
          "/src/assets/images/doctor_cardiology_portrait_1795016749598.jpg",
          nowIso,
          nowIso
        );
        const insAvail = db.prepare(`
          INSERT INTO doctor_availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available)
          VALUES (?, ?, ?, '09:30', '13:00', 30, 1)
        `);
        for (let day = 1; day <= 5; day++) {
          insAvail.run(`avail_${doctorId}_${day}`, doctorId, day);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "DOCTOR_ONBOARDED",
        resourceType: "Doctor",
        resourceId: doctorId,
        metadata: { specialization: input.specialization, licenseNumber: input.licenseNumber },
        ipAddress: req.ip
      });
      res.status(201).json({ doctorId, userId });
    } catch (err) {
      next(err);
    }
  }
);
var updateDoctorSchema = z2.object({
  fullName: z2.string().trim().min(2).max(120).optional(),
  phone: z2.string().trim().max(32).optional(),
  specialization: z2.string().trim().min(2).max(100).optional(),
  department: z2.string().trim().min(2).max(100).optional(),
  experienceYears: z2.coerce.number().int().min(0).max(70).optional(),
  consultationFee: z2.coerce.number().int().min(100).max(5e4).optional(),
  bio: z2.string().trim().max(1e3).optional()
});
directoryRouter.put(
  "/doctors/:id",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  (req, res, next) => {
    try {
      const doctor = db.prepare("SELECT id, user_id FROM doctors WHERE id = ?").get(req.params.id);
      if (!doctor) {
        res.status(404).json({ error: "Doctor not found." });
        return;
      }
      if (req.auth.role === "DOCTOR" && doctor.user_id !== req.auth.userId) {
        res.status(403).json({ error: "You can only update your own doctor profile." });
        return;
      }
      const input = updateDoctorSchema.parse(req.body);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      if (input.fullName !== void 0 || input.phone !== void 0) {
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
        doctor.id
      );
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "DOCTOR_PROFILE_UPDATED",
        resourceType: "Doctor",
        resourceId: doctor.id,
        ipAddress: req.ip
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);
var availabilityListSchema = z2.object({
  rules: z2.array(
    z2.object({
      dayOfWeek: z2.coerce.number().int().min(0).max(6),
      startTime: z2.string().regex(/^\d{2}:\d{2}$/),
      endTime: z2.string().regex(/^\d{2}:\d{2}$/),
      slotDurationMinutes: z2.coerce.number().int().min(10).max(120),
      isAvailable: z2.boolean()
    })
  )
});
directoryRouter.put(
  "/doctors/:id/availability",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  (req, res, next) => {
    try {
      const doctor = db.prepare("SELECT id, user_id FROM doctors WHERE id = ?").get(req.params.id);
      if (!doctor) {
        res.status(404).json({ error: "Doctor not found." });
        return;
      }
      if (req.auth.role === "DOCTOR" && doctor.user_id !== req.auth.userId) {
        res.status(403).json({ error: "Cannot modify another doctor schedule." });
        return;
      }
      const { rules } = availabilityListSchema.parse(req.body);
      for (const r of rules) {
        if (r.startTime >= r.endTime) {
          res.status(400).json({ error: `Invalid time range ${r.startTime} - ${r.endTime}.` });
          return;
        }
      }
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM doctor_availability WHERE doctor_id = ?").run(doctor.id);
        const ins = db.prepare(`
          INSERT INTO doctor_availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of rules) {
          ins.run(
            `avail_${crypto5.randomUUID().slice(0, 10)}`,
            doctor.id,
            r.dayOfWeek,
            r.startTime,
            r.endTime,
            r.slotDurationMinutes,
            r.isAvailable ? 1 : 0
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "DOCTOR_AVAILABILITY_UPDATED",
        resourceType: "Doctor",
        resourceId: doctor.id,
        metadata: { ruleCount: rules.length },
        ipAddress: req.ip
      });
      res.json({ ok: true, count: rules.length });
    } catch (err) {
      next(err);
    }
  }
);
directoryRouter.get(
  "/patients",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  (req, res) => {
    if (req.auth.role === "ADMIN") {
      const rows2 = db.prepare(`
          SELECT p.id, p.user_id, u.full_name, u.email, u.phone, u.is_active,
                 p.date_of_birth, p.gender, p.blood_group, p.allergies, p.emergency_contact, p.address
          FROM patients p
          JOIN users u ON u.id = p.user_id
          ORDER BY u.full_name ASC
        `).all();
      res.json({ patients: rows2 });
      return;
    }
    const doc = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
    if (!doc) {
      res.status(404).json({ error: "Doctor profile not found." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const rows = db.prepare(`
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
      `).all(doc.id, doc.id, nowIso);
    res.json({ patients: rows });
  }
);
directoryRouter.get("/patients/:id", requireAuth, (req, res) => {
  const patient = db.prepare(`
      SELECT p.*, u.full_name, u.email, u.phone, u.is_active
      FROM patients p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
    `).get(req.params.id);
  if (!patient) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  if (req.auth.role === "PATIENT" && patient.user_id !== req.auth.userId) {
    res.status(403).json({ error: "Forbidden: cannot access another patient profile." });
    return;
  }
  if (req.auth.role === "DOCTOR") {
    const doc = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const hasRelationship = doc && (db.prepare("SELECT 1 FROM appointments WHERE patient_id = ? AND doctor_id = ?").get(req.params.id, doc.id) || db.prepare(
      "SELECT 1 FROM record_sharing_permissions WHERE patient_id = ? AND doctor_id = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > ?"
    ).get(req.params.id, doc.id, nowIso));
    if (!hasRelationship) {
      res.status(403).json({ error: "Forbidden: you are not authorized for this patient." });
      return;
    }
  }
  res.json({ patient });
});
var updatePatientSchema = z2.object({
  fullName: z2.string().trim().min(2).max(120).optional(),
  phone: z2.string().trim().max(32).optional(),
  dateOfBirth: z2.string().trim().max(20).optional(),
  gender: z2.string().trim().max(30).optional(),
  bloodGroup: z2.string().trim().max(10).optional(),
  allergies: z2.string().trim().max(500).optional(),
  emergencyContact: z2.string().trim().max(160).optional(),
  address: z2.string().trim().max(300).optional()
});
directoryRouter.put("/patients/:id", requireAuth, (req, res, next) => {
  try {
    const patient = db.prepare("SELECT id, user_id FROM patients WHERE id = ?").get(req.params.id);
    if (!patient) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    if (req.auth.role === "PATIENT" && patient.user_id !== req.auth.userId) {
      res.status(403).json({ error: "Forbidden: cannot modify another patient profile." });
      return;
    }
    if (req.auth.role === "DOCTOR") {
      res.status(403).json({ error: "Doctors cannot alter patient personal demographics." });
      return;
    }
    const input = updatePatientSchema.parse(req.body);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (input.fullName !== void 0 || input.phone !== void 0) {
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
      patient.id
    );
    recordAuditLog({
      actorUserId: req.auth.userId,
      action: "PATIENT_PROFILE_UPDATED",
      resourceType: "Patient",
      resourceId: patient.id,
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// server/routes/appointmentRoutes.ts
import { Router as Router3 } from "express";
import crypto6 from "node:crypto";
import { z as z3 } from "zod";
var appointmentRouter = Router3();
var createAppointmentSchema = z3.object({
  doctorId: z3.string().min(1),
  scheduledStart: z3.string().datetime(),
  scheduledEnd: z3.string().datetime(),
  reason: z3.string().trim().min(3, "Please provide a consultation reason").max(500)
});
var statusUpdateSchema = z3.object({
  status: z3.enum([
    "APPROVED",
    "REJECTED",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW"
  ]),
  consultationNotes: z3.string().trim().max(2e3).optional()
});
var rescheduleSchema = z3.object({
  scheduledStart: z3.string().datetime(),
  scheduledEnd: z3.string().datetime()
});
function selectAppointmentsBase(whereClause, params) {
  return db.prepare(`
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
    `).all(...params);
}
appointmentRouter.get("/", requireAuth, (req, res) => {
  const statusFilter = typeof req.query.status === "string" && req.query.status !== "ALL" ? req.query.status : null;
  let rows = [];
  if (req.auth.role === "PATIENT") {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.auth.userId);
    if (!patient) {
      res.json({ appointments: [] });
      return;
    }
    rows = statusFilter ? selectAppointmentsBase("WHERE a.patient_id = ? AND a.status = ?", [
      patient.id,
      statusFilter
    ]) : selectAppointmentsBase("WHERE a.patient_id = ?", [patient.id]);
  } else if (req.auth.role === "DOCTOR") {
    const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
    if (!doctor) {
      res.json({ appointments: [] });
      return;
    }
    rows = statusFilter ? selectAppointmentsBase("WHERE a.doctor_id = ? AND a.status = ?", [
      doctor.id,
      statusFilter
    ]) : selectAppointmentsBase("WHERE a.doctor_id = ?", [doctor.id]);
  } else {
    rows = statusFilter ? selectAppointmentsBase("WHERE a.status = ?", [statusFilter]) : selectAppointmentsBase("", []);
  }
  res.json({ appointments: rows });
});
appointmentRouter.get("/:id", requireAuth, (req, res) => {
  const rows = selectAppointmentsBase("WHERE a.id = ?", [req.params.id]);
  const appt = rows[0];
  if (!appt) {
    res.status(404).json({ error: "Appointment not found." });
    return;
  }
  if (req.auth.role === "PATIENT" && appt.patient_user_id !== req.auth.userId) {
    res.status(403).json({ error: "Forbidden: appointment belongs to another patient." });
    return;
  }
  if (req.auth.role === "DOCTOR" && appt.doctor_user_id !== req.auth.userId) {
    res.status(403).json({ error: "Forbidden: appointment belongs to another doctor." });
    return;
  }
  res.json({ appointment: appt });
});
appointmentRouter.post(
  "/",
  requireAuth,
  requireRole("PATIENT"),
  async (req, res, next) => {
    try {
      const input = createAppointmentSchema.parse(req.body);
      const patient = db.prepare(`
          SELECT p.id, u.full_name, u.email
          FROM patients p JOIN users u ON u.id = p.user_id
          WHERE p.user_id = ?
        `).get(req.auth.userId);
      if (!patient) {
        res.status(404).json({ error: "Patient profile not found." });
        return;
      }
      const doctor = db.prepare(`
          SELECT d.id, u.id AS user_id, u.full_name, u.email, u.is_active, d.specialization
          FROM doctors d JOIN users u ON u.id = d.user_id
          WHERE d.id = ?
        `).get(input.doctorId);
      if (!doctor || doctor.is_active !== 1) {
        res.status(404).json({ error: "Selected doctor is not currently available." });
        return;
      }
      if (Date.parse(input.scheduledStart) <= Date.now()) {
        res.status(400).json({ error: "Appointment must be scheduled in the future." });
        return;
      }
      const apptId = `appt_${crypto6.randomUUID().slice(0, 12)}`;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const doctorIntervals = db.prepare("SELECT scheduled_start, scheduled_end, status FROM appointments WHERE doctor_id = ?").all(doctor.id).map((row) => ({
          scheduledStart: String(row.scheduled_start),
          scheduledEnd: String(row.scheduled_end),
          status: row.status
        }));
        if (hasAppointmentOverlap(input.scheduledStart, input.scheduledEnd, doctorIntervals)) {
          db.exec("ROLLBACK");
          res.status(409).json({
            error: "This appointment slot overlaps an existing booking for the selected doctor."
          });
          return;
        }
        const patientIntervals = db.prepare("SELECT scheduled_start, scheduled_end, status FROM appointments WHERE patient_id = ?").all(patient.id).map((row) => ({
          scheduledStart: String(row.scheduled_start),
          scheduledEnd: String(row.scheduled_end),
          status: row.status
        }));
        if (hasAppointmentOverlap(input.scheduledStart, input.scheduledEnd, patientIntervals)) {
          db.exec("ROLLBACK");
          res.status(409).json({
            error: "You already have an overlapping appointment scheduled at this time."
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
          nowIso
        );
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const istFormatted = formatIstDateTime(input.scheduledStart);
      await dispatchNotification({
        userId: req.auth.userId,
        recipientEmail: patient.email,
        appointmentId: apptId,
        type: "APPOINTMENT_BOOKED",
        subject: `Appointment Requested \u2014 ${doctor.full_name}`,
        message: `Your ${doctor.specialization} appointment request with ${doctor.full_name} for ${istFormatted} (Asia/Kolkata) has been submitted.`,
        sendEmail: true
      });
      await dispatchNotification({
        userId: doctor.user_id,
        recipientEmail: doctor.email,
        appointmentId: apptId,
        type: "APPOINTMENT_REQUESTED",
        subject: `New Appointment Request \u2014 ${patient.full_name}`,
        message: `${patient.full_name} requested an appointment for ${istFormatted} (Asia/Kolkata). Reason: ${input.reason}`,
        sendEmail: true
      });
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "APPOINTMENT_REQUESTED",
        resourceType: "Appointment",
        resourceId: apptId,
        metadata: { doctorId: doctor.id, scheduledStart: input.scheduledStart },
        ipAddress: req.ip
      });
      const created = selectAppointmentsBase("WHERE a.id = ?", [apptId])[0];
      res.status(201).json({ appointment: created });
    } catch (err) {
      next(err);
    }
  }
);
appointmentRouter.patch(
  "/:id/status",
  requireAuth,
  async (req, res, next) => {
    try {
      const input = statusUpdateSchema.parse(req.body);
      const appt = selectAppointmentsBase("WHERE a.id = ?", [req.params.id])[0];
      if (!appt) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      if (req.auth.role === "PATIENT" && appt.patient_user_id !== req.auth.userId) {
        res.status(403).json({ error: "Forbidden: cannot update another patient appointment." });
        return;
      }
      if (req.auth.role === "DOCTOR" && appt.doctor_user_id !== req.auth.userId) {
        res.status(403).json({ error: "Forbidden: appointment is assigned to another doctor." });
        return;
      }
      const currentStatus = appt.status;
      if (!canTransitionAppointmentStatus(
        currentStatus,
        input.status,
        req.auth.role
      )) {
        res.status(400).json({
          error: `Transition from ${currentStatus} to ${input.status} is not permitted for role ${req.auth.role}.`
        });
        return;
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
        req.params.id
      );
      const istTime = formatIstDateTime(String(appt.scheduled_start));
      await dispatchNotification({
        userId: String(appt.patient_user_id),
        recipientEmail: String(appt.patient_email),
        appointmentId: req.params.id,
        type: `APPOINTMENT_${input.status}`,
        subject: `Appointment ${input.status} \u2014 ${String(appt.doctor_name)}`,
        message: `Your appointment with ${String(appt.doctor_name)} (${istTime} IST) is now ${input.status}.`,
        sendEmail: true
      });
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: `APPOINTMENT_${input.status}`,
        resourceType: "Appointment",
        resourceId: req.params.id,
        metadata: { from: currentStatus, to: input.status },
        ipAddress: req.ip
      });
      const updated = selectAppointmentsBase("WHERE a.id = ?", [req.params.id])[0];
      res.json({ appointment: updated });
    } catch (err) {
      next(err);
    }
  }
);
appointmentRouter.patch(
  "/:id/reschedule",
  requireAuth,
  async (req, res, next) => {
    try {
      const input = rescheduleSchema.parse(req.body);
      const appt = selectAppointmentsBase("WHERE a.id = ?", [req.params.id])[0];
      if (!appt) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      if (req.auth.role === "PATIENT" && appt.patient_user_id !== req.auth.userId) {
        res.status(403).json({ error: "Forbidden: cannot reschedule another patient appointment." });
        return;
      }
      if (req.auth.role === "DOCTOR" && appt.doctor_user_id !== req.auth.userId) {
        res.status(403).json({ error: "Forbidden: cannot reschedule another doctor appointment." });
        return;
      }
      const currentStatus = appt.status;
      if (["COMPLETED", "CANCELLED", "REJECTED", "NO_SHOW"].includes(currentStatus)) {
        res.status(400).json({ error: `Cannot reschedule an appointment in ${currentStatus} state.` });
        return;
      }
      if (Date.parse(input.scheduledStart) <= Date.now()) {
        res.status(400).json({ error: "Rescheduled slot must be in the future." });
        return;
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const others = db.prepare(
          "SELECT scheduled_start, scheduled_end, status FROM appointments WHERE doctor_id = ? AND id != ?"
        ).all(String(appt.doctor_id), req.params.id).map((row) => ({
          scheduledStart: String(row.scheduled_start),
          scheduledEnd: String(row.scheduled_end),
          status: row.status
        }));
        if (hasAppointmentOverlap(input.scheduledStart, input.scheduledEnd, others)) {
          db.exec("ROLLBACK");
          res.status(409).json({
            error: "Requested reschedule slot conflicts with another booking."
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
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      const istTime = formatIstDateTime(input.scheduledStart);
      await dispatchNotification({
        userId: String(appt.doctor_user_id),
        recipientEmail: String(appt.doctor_email),
        appointmentId: req.params.id,
        type: "APPOINTMENT_RESCHEDULED",
        subject: `Appointment Rescheduled \u2014 ${String(appt.patient_name)}`,
        message: `${String(appt.patient_name)} requested to reschedule to ${istTime} (Asia/Kolkata).`,
        sendEmail: true
      });
      await dispatchNotification({
        userId: String(appt.patient_user_id),
        recipientEmail: String(appt.patient_email),
        appointmentId: req.params.id,
        type: "APPOINTMENT_RESCHEDULED",
        subject: `Appointment Rescheduled \u2014 ${String(appt.doctor_name)}`,
        message: `Your appointment with ${String(appt.doctor_name)} has been moved to ${istTime} (Asia/Kolkata) and awaits doctor confirmation.`,
        sendEmail: true
      });
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "APPOINTMENT_RESCHEDULED",
        resourceType: "Appointment",
        resourceId: req.params.id,
        metadata: { newStart: input.scheduledStart },
        ipAddress: req.ip
      });
      const updated = selectAppointmentsBase("WHERE a.id = ?", [req.params.id])[0];
      res.json({ appointment: updated });
    } catch (err) {
      next(err);
    }
  }
);
appointmentRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const appt = selectAppointmentsBase("WHERE a.id = ?", [req.params.id])[0];
    if (!appt) {
      res.status(404).json({ error: "Appointment not found." });
      return;
    }
    if (req.auth.role === "PATIENT" && appt.patient_user_id !== req.auth.userId) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
    const currentStatus = appt.status;
    if (!canTransitionAppointmentStatus(currentStatus, "CANCELLED", req.auth.role)) {
      res.status(400).json({ error: `Appointment in ${currentStatus} state cannot be cancelled.` });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`UPDATE appointments SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(
      nowIso,
      req.params.id
    );
    recordAuditLog({
      actorUserId: req.auth.userId,
      action: "APPOINTMENT_CANCELLED",
      resourceType: "Appointment",
      resourceId: req.params.id,
      ipAddress: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// server/routes/recordsRoutes.ts
import express, { Router as Router4 } from "express";
import crypto8 from "node:crypto";
import jwt3 from "jsonwebtoken";
import { z as z4 } from "zod";

// server/services/storageService.ts
import crypto7 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import jwt2 from "jsonwebtoken";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
var s3Client = null;
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({ region: env.awsRegion });
  }
  return s3Client;
}
async function createPresignedUploadGrant(params) {
  if (!ALLOWED_REPORT_MIME_TYPES.includes(params.mimeType)) {
    throw new Error("Unsupported medical report file type. Allowed: PDF, JPEG, PNG.");
  }
  if (params.fileSizeBytes <= 0 || params.fileSizeBytes > MAX_REPORT_SIZE_BYTES) {
    throw new Error("File size exceeds maximum 10 MB limit.");
  }
  const ext = params.mimeType === "application/pdf" ? "pdf" : params.mimeType === "image/png" ? "png" : "jpg";
  const safeKey = `records/${params.patientId}/${crypto7.randomUUID()}.${ext}`;
  const expiresInSeconds = 300;
  if (isS3Configured()) {
    const command = new PutObjectCommand({
      Bucket: env.awsS3Bucket,
      Key: safeKey,
      ContentType: params.mimeType,
      ServerSideEncryption: "AES256"
    });
    const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
    return {
      storageKey: safeKey,
      uploadUrl,
      method: "PUT",
      expiresInSeconds,
      provider: "aws-s3"
    };
  }
  const token = jwt2.sign(
    {
      purpose: "UPLOAD",
      storageKey: safeKey,
      patientId: params.patientId,
      doctorId: params.doctorId,
      mimeType: params.mimeType
    },
    env.jwtSecret,
    { expiresIn: expiresInSeconds }
  );
  return {
    storageKey: safeKey,
    uploadUrl: `/api/medical-records/upload/${token}`,
    method: "PUT",
    expiresInSeconds,
    provider: "local-vault"
  };
}
function saveValidatedObjectToLocalVault(storageKey, buffer, expectedMime) {
  if (buffer.length === 0 || buffer.length > MAX_REPORT_SIZE_BYTES) {
    throw new Error("Invalid file size (must be between 1 byte and 10 MB).");
  }
  const detectedMime = detectFileMimeFromBytes(new Uint8Array(buffer));
  if (!detectedMime || detectedMime !== expectedMime) {
    throw new Error(
      `File signature mismatch: declared ${expectedMime}, detected ${detectedMime || "unknown/unsafe"}.`
    );
  }
  const resolvedPath = path2.resolve(uploadsDir, storageKey);
  if (!resolvedPath.startsWith(uploadsDir + path2.sep)) {
    throw new Error("Invalid storage key path.");
  }
  fs2.mkdirSync(path2.dirname(resolvedPath), { recursive: true });
  fs2.writeFileSync(resolvedPath, buffer);
  const sha256 = crypto7.createHash("sha256").update(buffer).digest("hex");
  return {
    sha256,
    actualMime: detectedMime,
    byteLength: buffer.length
  };
}
function verifyLocalVaultObject(storageKey) {
  const resolvedPath = path2.resolve(uploadsDir, storageKey);
  if (!resolvedPath.startsWith(uploadsDir + path2.sep) || !fs2.existsSync(resolvedPath)) {
    return { exists: false, byteLength: 0, sha256: "" };
  }
  const buf = fs2.readFileSync(resolvedPath);
  return {
    exists: true,
    byteLength: buf.length,
    sha256: crypto7.createHash("sha256").update(buf).digest("hex")
  };
}
async function createPresignedDownloadGrant(params) {
  const expiresInSeconds = 120;
  if (isS3Configured()) {
    const command = new GetObjectCommand({
      Bucket: env.awsS3Bucket,
      Key: params.storageKey,
      ResponseContentDisposition: `attachment; filename="${params.fileName.replace(/"/g, "")}"`
    });
    const downloadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
    return {
      downloadUrl,
      expiresInSeconds,
      provider: "aws-s3"
    };
  }
  const token = jwt2.sign(
    {
      purpose: "DOWNLOAD",
      recordId: params.recordId,
      storageKey: params.storageKey,
      fileName: params.fileName,
      mimeType: params.mimeType,
      requestedByUserId: params.requestedByUserId
    },
    env.jwtSecret,
    { expiresIn: expiresInSeconds }
  );
  return {
    downloadUrl: `/api/medical-records/download/${token}`,
    expiresInSeconds,
    provider: "local-vault"
  };
}
function readLocalVaultObject(storageKey) {
  const resolvedPath = path2.resolve(uploadsDir, storageKey);
  if (!resolvedPath.startsWith(uploadsDir + path2.sep) || !fs2.existsSync(resolvedPath)) {
    throw new Error("Medical report object not found in private vault.");
  }
  return fs2.readFileSync(resolvedPath);
}

// server/routes/recordsRoutes.ts
var recordsRouter = Router4();
function isDoctorAuthorizedForPatient(doctorId, patientId) {
  const appt = db.prepare("SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ?").get(doctorId, patientId);
  if (appt) return true;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const share = db.prepare(
    "SELECT 1 FROM record_sharing_permissions WHERE doctor_id = ? AND patient_id = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > ?"
  ).get(doctorId, patientId, nowIso);
  return Boolean(share);
}
var uploadUrlSchema = z4.object({
  patientId: z4.string().min(1),
  fileName: z4.string().trim().min(3).max(200),
  mimeType: z4.enum(ALLOWED_REPORT_MIME_TYPES),
  fileSizeBytes: z4.coerce.number().int().min(1).max(MAX_REPORT_SIZE_BYTES)
});
recordsRouter.post(
  "/medical-records/upload-url",
  requireAuth,
  requireRole("DOCTOR"),
  async (req, res, next) => {
    try {
      const input = uploadUrlSchema.parse(req.body);
      const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
      if (!doctor) {
        res.status(404).json({ error: "Doctor profile not found." });
        return;
      }
      const patient = db.prepare("SELECT id FROM patients WHERE id = ?").get(input.patientId);
      if (!patient) {
        res.status(404).json({ error: "Patient not found." });
        return;
      }
      if (!isDoctorAuthorizedForPatient(doctor.id, input.patientId)) {
        res.status(403).json({
          error: "Forbidden: you may only upload reports for patients assigned to your appointments or sharing grants."
        });
        return;
      }
      const grant = await createPresignedUploadGrant({
        patientId: input.patientId,
        doctorId: doctor.id,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes
      });
      res.json(grant);
    } catch (err) {
      next(err);
    }
  }
);
recordsRouter.put(
  "/medical-records/upload/:token",
  express.raw({ type: "*/*", limit: "11mb" }),
  (req, res) => {
    try {
      const payload = jwt3.verify(req.params.token, env.jwtSecret);
      if (payload.purpose !== "UPLOAD") {
        res.status(403).json({ error: "Invalid upload token." });
        return;
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      const result = saveValidatedObjectToLocalVault(
        payload.storageKey,
        buffer,
        payload.mimeType
      );
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Upload validation failed."
      });
    }
  }
);
var confirmUploadSchema = z4.object({
  patientId: z4.string().min(1),
  appointmentId: z4.string().optional().nullable(),
  title: z4.string().trim().min(2).max(160),
  category: z4.string().trim().min(2).max(80),
  fileName: z4.string().trim().min(3).max(200),
  mimeType: z4.enum(ALLOWED_REPORT_MIME_TYPES),
  fileSizeBytes: z4.coerce.number().int().min(1).max(MAX_REPORT_SIZE_BYTES),
  storageKey: z4.string().min(8).max(260),
  notes: z4.string().trim().max(1e3).optional().default("")
});
recordsRouter.post(
  "/medical-records/confirm-upload",
  requireAuth,
  requireRole("DOCTOR"),
  async (req, res, next) => {
    try {
      const input = confirmUploadSchema.parse(req.body);
      const doctor = db.prepare(
        "SELECT d.id, u.full_name FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?"
      ).get(req.auth.userId);
      if (!doctor) {
        res.status(404).json({ error: "Doctor profile not found." });
        return;
      }
      if (!isDoctorAuthorizedForPatient(doctor.id, input.patientId)) {
        res.status(403).json({ error: "Forbidden: unauthorized patient." });
        return;
      }
      const patient = db.prepare(
        "SELECT p.id, u.id AS user_id, u.email, u.full_name FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = ?"
      ).get(input.patientId);
      if (!patient) {
        res.status(404).json({ error: "Patient not found." });
        return;
      }
      let sha256 = "s3-sse-aes256-verified";
      let byteLength = input.fileSizeBytes;
      if (!isS3Configured()) {
        const verified = verifyLocalVaultObject(input.storageKey);
        if (!verified.exists) {
          res.status(400).json({
            error: "Uploaded file object could not be verified in private storage."
          });
          return;
        }
        sha256 = verified.sha256;
        byteLength = verified.byteLength;
      }
      const recordId = `rec_${crypto8.randomUUID().slice(0, 12)}`;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
        nowIso
      );
      await dispatchNotification({
        userId: patient.user_id,
        recipientEmail: patient.email,
        appointmentId: input.appointmentId || null,
        type: "MEDICAL_RECORD_UPLOADED",
        subject: `New Medical Report \u2014 ${input.title}`,
        message: `${doctor.full_name} uploaded "${input.title}" (${input.category}) to your encrypted MediCloud records.`,
        sendEmail: true
      });
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "MEDICAL_RECORD_UPLOADED",
        resourceType: "MedicalRecord",
        resourceId: recordId,
        metadata: { patientId: patient.id, title: input.title, mimeType: input.mimeType },
        ipAddress: req.ip
      });
      const created = db.prepare(`
          SELECT m.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization
          FROM medical_records m
          JOIN doctors d ON d.id = m.uploaded_by_doctor_id
          JOIN users du ON du.id = d.user_id
          WHERE m.id = ?
        `).get(recordId);
      res.status(201).json({ record: created });
    } catch (err) {
      next(err);
    }
  }
);
recordsRouter.get("/medical-records", requireAuth, (req, res) => {
  if (req.auth.role === "ADMIN") {
    res.status(403).json({
      error: "Least-privilege policy: administrators cannot access private patient medical documents."
    });
    return;
  }
  if (req.auth.role === "PATIENT") {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.auth.userId);
    if (!patient) {
      res.json({ records: [] });
      return;
    }
    const rows2 = db.prepare(`
        SELECT m.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization,
               pu.full_name AS patient_name
        FROM medical_records m
        JOIN doctors d ON d.id = m.uploaded_by_doctor_id
        JOIN users du ON du.id = d.user_id
        JOIN patients p ON p.id = m.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE m.patient_id = ?
        ORDER BY m.created_at DESC
      `).all(patient.id);
    res.json({ records: rows2 });
    return;
  }
  const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
  if (!doctor) {
    res.json({ records: [] });
    return;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const rows = db.prepare(`
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
    `).all(doctor.id, doctor.id, doctor.id, nowIso);
  res.json({ records: rows });
});
recordsRouter.get(
  "/medical-records/:id/download-url",
  requireAuth,
  async (req, res, next) => {
    try {
      if (req.auth.role === "ADMIN") {
        res.status(403).json({
          error: "Least-privilege policy: administrators cannot download private medical reports."
        });
        return;
      }
      const record = db.prepare(`
          SELECT m.*, p.user_id AS patient_user_id
          FROM medical_records m
          JOIN patients p ON p.id = m.patient_id
          WHERE m.id = ?
        `).get(req.params.id);
      if (!record) {
        res.status(404).json({ error: "Medical record not found." });
        return;
      }
      let authorized = false;
      if (req.auth.role === "PATIENT") {
        authorized = record.patient_user_id === req.auth.userId;
      } else if (req.auth.role === "DOCTOR") {
        const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
        if (doctor) {
          if (record.uploaded_by_doctor_id === doctor.id) {
            authorized = true;
          } else {
            const shares = db.prepare(
              "SELECT is_active, revoked_at, expires_at FROM record_sharing_permissions WHERE record_id = ? AND doctor_id = ?"
            ).all(record.id, doctor.id);
            authorized = shares.some(
              (s) => isSharingPermissionActive({
                isActive: s.is_active === 1,
                revokedAt: s.revoked_at,
                expiresAt: s.expires_at
              })
            );
          }
        }
      }
      if (!authorized) {
        recordAuditLog({
          actorUserId: req.auth.userId,
          action: "MEDICAL_RECORD_ACCESS_DENIED",
          resourceType: "MedicalRecord",
          resourceId: record.id,
          ipAddress: req.ip
        });
        res.status(403).json({
          error: "Forbidden: you do not have permission to access this medical record."
        });
        return;
      }
      const grant = await createPresignedDownloadGrant({
        recordId: record.id,
        storageKey: record.storage_key,
        fileName: record.file_name,
        mimeType: record.mime_type,
        requestedByUserId: req.auth.userId
      });
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "MEDICAL_RECORD_DOWNLOAD_URL_ISSUED",
        resourceType: "MedicalRecord",
        resourceId: record.id,
        metadata: { fileName: record.file_name, provider: grant.provider },
        ipAddress: req.ip
      });
      res.json(grant);
    } catch (err) {
      next(err);
    }
  }
);
recordsRouter.get("/medical-records/download/:token", (req, res) => {
  try {
    const payload = jwt3.verify(req.params.token, env.jwtSecret);
    if (payload.purpose !== "DOWNLOAD") {
      res.status(403).json({ error: "Invalid download token." });
      return;
    }
    const buf = readLocalVaultObject(payload.storageKey);
    res.setHeader("Content-Type", payload.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${payload.fileName.replace(/"/g, "")}"`
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch {
    res.status(403).json({ error: "Download link has expired or is invalid." });
  }
});
recordsRouter.get(
  "/medical-records/:id/access-history",
  requireAuth,
  requireRole("PATIENT"),
  (req, res) => {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.auth.userId);
    const record = db.prepare("SELECT id, patient_id FROM medical_records WHERE id = ?").get(req.params.id);
    if (!record || !patient || record.patient_id !== patient.id) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
    const logs = db.prepare(`
        SELECT a.id, a.action, a.created_at, a.metadata_json, u.full_name AS actor_name, u.role AS actor_role
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.resource_type = 'MedicalRecord' AND a.resource_id = ?
        ORDER BY a.created_at DESC
        LIMIT 50
      `).all(record.id);
    res.json({ history: logs });
  }
);
recordsRouter.get("/sharing", requireAuth, (req, res) => {
  if (req.auth.role === "PATIENT") {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.auth.userId);
    if (!patient) {
      res.json({ permissions: [] });
      return;
    }
    const rows = db.prepare(`
        SELECT s.*, m.title AS record_title, m.category AS record_category,
               du.full_name AS doctor_name, d.specialization AS doctor_specialization
        FROM record_sharing_permissions s
        JOIN medical_records m ON m.id = s.record_id
        JOIN doctors d ON d.id = s.doctor_id
        JOIN users du ON du.id = d.user_id
        WHERE s.patient_id = ?
        ORDER BY s.granted_at DESC
      `).all(patient.id);
    res.json({ permissions: rows });
    return;
  }
  if (req.auth.role === "DOCTOR") {
    const doctor = db.prepare("SELECT id FROM doctors WHERE user_id = ?").get(req.auth.userId);
    if (!doctor) {
      res.json({ permissions: [] });
      return;
    }
    const rows = db.prepare(`
        SELECT s.*, m.title AS record_title, pu.full_name AS patient_name
        FROM record_sharing_permissions s
        JOIN medical_records m ON m.id = s.record_id
        JOIN patients p ON p.id = s.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE s.doctor_id = ? AND s.is_active = 1 AND s.revoked_at IS NULL
        ORDER BY s.granted_at DESC
      `).all(doctor.id);
    res.json({ permissions: rows });
    return;
  }
  res.status(403).json({ error: "Forbidden." });
});
var createShareSchema = z4.object({
  recordId: z4.string().min(1),
  doctorId: z4.string().min(1),
  durationDays: z4.coerce.number().int().min(1).max(365).default(14)
});
recordsRouter.post(
  "/sharing",
  requireAuth,
  requireRole("PATIENT"),
  async (req, res, next) => {
    try {
      const input = createShareSchema.parse(req.body);
      const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.auth.userId);
      if (!patient) {
        res.status(404).json({ error: "Patient profile not found." });
        return;
      }
      const record = db.prepare("SELECT id, patient_id, title FROM medical_records WHERE id = ?").get(input.recordId);
      if (!record || record.patient_id !== patient.id) {
        res.status(403).json({ error: "You can only share your own medical records." });
        return;
      }
      const doctor = db.prepare(
        "SELECT d.id, u.id AS user_id, u.full_name, u.email FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.id = ? AND u.is_active = 1"
      ).get(input.doctorId);
      if (!doctor) {
        res.status(404).json({ error: "Selected doctor not found." });
        return;
      }
      const id = `share_${crypto8.randomUUID().slice(0, 12)}`;
      const now = /* @__PURE__ */ new Date();
      const nowIso = now.toISOString();
      const expiresIso = new Date(
        now.getTime() + input.durationDays * 24 * 3600 * 1e3
      ).toISOString();
      db.prepare(`
        INSERT INTO record_sharing_permissions (id, record_id, patient_id, doctor_id, granted_at, expires_at, revoked_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
      `).run(id, record.id, patient.id, doctor.id, nowIso, expiresIso);
      await dispatchNotification({
        userId: doctor.user_id,
        recipientEmail: doctor.email,
        type: "RECORD_SHARED",
        subject: `Medical Record Shared \u2014 ${record.title}`,
        message: `A patient granted you ${input.durationDays}-day access to "${record.title}".`,
        sendEmail: false
      });
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: "RECORD_CONSENT_GRANTED",
        resourceType: "RecordSharingPermission",
        resourceId: id,
        metadata: { recordId: record.id, doctorId: doctor.id, expiresAt: expiresIso },
        ipAddress: req.ip
      });
      res.status(201).json({ id, expiresAt: expiresIso });
    } catch (err) {
      next(err);
    }
  }
);
recordsRouter.patch(
  "/sharing/:id/revoke",
  requireAuth,
  requireRole("PATIENT"),
  (req, res) => {
    const patient = db.prepare("SELECT id FROM patients WHERE user_id = ?").get(req.auth.userId);
    const perm = db.prepare("SELECT id, patient_id, record_id, doctor_id FROM record_sharing_permissions WHERE id = ?").get(req.params.id);
    if (!perm || !patient || perm.patient_id !== patient.id) {
      res.status(403).json({ error: "Forbidden: cannot revoke this consent grant." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`
      UPDATE record_sharing_permissions
      SET is_active = 0, revoked_at = ?
      WHERE id = ?
    `).run(nowIso, perm.id);
    recordAuditLog({
      actorUserId: req.auth.userId,
      action: "RECORD_CONSENT_REVOKED",
      resourceType: "RecordSharingPermission",
      resourceId: perm.id,
      metadata: { recordId: perm.record_id, doctorId: perm.doctor_id },
      ipAddress: req.ip
    });
    res.json({ ok: true });
  }
);

// server/routes/adminAndDashboardRoutes.ts
import { Router as Router5 } from "express";
import { z as z5 } from "zod";

// server/jobs/reminderWorker.ts
async function run24HourReminderSweep() {
  const now = Date.now();
  const windowEndIso = new Date(now + 24 * 3600 * 1e3).toISOString();
  const nowIso = new Date(now).toISOString();
  const rows = db.prepare(`
    SELECT
      a.id,
      a.scheduled_start,
      a.reason,
      pu.id AS patient_user_id,
      pu.email AS patient_email,
      pu.full_name AS patient_name,
      du.full_name AS doctor_name,
      d.specialization
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users pu ON pu.id = p.user_id
    JOIN doctors d ON d.id = a.doctor_id
    JOIN users du ON du.id = d.user_id
    WHERE a.status = 'APPROVED'
      AND a.reminder_sent_at IS NULL
      AND a.scheduled_start > ?
      AND a.scheduled_start <= ?
  `).all(nowIso, windowEndIso);
  const sentIds = [];
  for (const row of rows) {
    const formattedIst = formatIstDateTime(row.scheduled_start);
    const subject = `Appointment Reminder: ${row.doctor_name} (${formattedIst} IST)`;
    const message = `Hello ${row.patient_name}, this is an automated reminder for your approved ${row.specialization} appointment with ${row.doctor_name} scheduled at ${formattedIst} (Asia/Kolkata). Reason: ${row.reason}.`;
    await dispatchNotification({
      userId: row.patient_user_id,
      recipientEmail: row.patient_email,
      appointmentId: row.id,
      type: "APPOINTMENT_REMINDER_24H",
      subject,
      message,
      sendEmail: true
    });
    db.prepare(`
      UPDATE appointments
      SET reminder_sent_at = ?, updated_at = ?
      WHERE id = ? AND reminder_sent_at IS NULL
    `).run(nowIso, nowIso, row.id);
    recordAuditLog({
      actorUserId: null,
      action: "REMINDER_24H_DISPATCHED",
      resourceType: "Appointment",
      resourceId: row.id,
      metadata: { scheduledStart: row.scheduled_start, channel: "IN_APP+EMAIL" },
      ipAddress: "scheduler-worker"
    });
    sentIds.push(row.id);
  }
  return {
    checkedAt: nowIso,
    remindersSent: sentIds.length,
    appointmentIds: sentIds
  };
}
var workerTimer = null;
function startReminderWorker() {
  if (workerTimer) return;
  setTimeout(() => {
    void run24HourReminderSweep().catch((err) => console.error("[ReminderWorker]", err));
  }, 5e3);
  workerTimer = setInterval(() => {
    void run24HourReminderSweep().catch((err) => console.error("[ReminderWorker]", err));
  }, 5 * 60 * 1e3);
}

// server/routes/adminAndDashboardRoutes.ts
var adminAndDashboardRouter = Router5();
adminAndDashboardRouter.get("/notifications", requireAuth, (req, res) => {
  const rows = db.prepare(`
      SELECT id, appointment_id, type, channel, subject, message, delivery_status, is_read, sent_at, created_at
      FROM notifications
      WHERE user_id = ? AND channel = 'IN_APP'
      ORDER BY created_at DESC
      LIMIT 40
    `).all(req.auth.userId);
  res.json({ notifications: rows });
});
adminAndDashboardRouter.patch(
  "/notifications/:id/read",
  requireAuth,
  (req, res) => {
    const existing = db.prepare("SELECT id, user_id FROM notifications WHERE id = ?").get(req.params.id);
    if (!existing || existing.user_id !== req.auth.userId) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(existing.id);
    res.json({ ok: true });
  }
);
adminAndDashboardRouter.post(
  "/notifications/read-all",
  requireAuth,
  (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.auth.userId);
    res.json({ ok: true });
  }
);
adminAndDashboardRouter.get(
  "/dashboard/patient",
  requireAuth,
  requireRole("PATIENT"),
  (req, res) => {
    const patient = db.prepare(`
        SELECT p.*, u.full_name, u.email, u.phone
        FROM patients p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ?
      `).get(req.auth.userId);
    if (!patient) {
      res.status(404).json({ error: "Patient profile not found." });
      return;
    }
    const appointments = db.prepare(`
        SELECT a.*, du.full_name AS doctor_name, d.specialization AS doctor_specialization
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users du ON du.id = d.user_id
        WHERE a.patient_id = ?
        ORDER BY a.scheduled_start DESC
      `).all(String(patient.id));
    const recentRecords = db.prepare(`
        SELECT m.id, m.title, m.category, m.file_name, m.mime_type, m.file_size_bytes, m.created_at,
               du.full_name AS doctor_name
        FROM medical_records m
        JOIN doctors d ON d.id = m.uploaded_by_doctor_id
        JOIN users du ON du.id = d.user_id
        WHERE m.patient_id = ?
        ORDER BY m.created_at DESC
        LIMIT 5
      `).all(String(patient.id));
    const unreadNotifications = db.prepare(
      "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND channel = 'IN_APP' AND is_read = 0"
    ).get(req.auth.userId).cnt;
    const activeShares = db.prepare(
      "SELECT COUNT(*) AS cnt FROM record_sharing_permissions WHERE patient_id = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > ?"
    ).get(String(patient.id), (/* @__PURE__ */ new Date()).toISOString()).cnt;
    res.json({
      profile: patient,
      appointments,
      recentRecords,
      unreadNotifications,
      activeShares
    });
  }
);
adminAndDashboardRouter.get(
  "/dashboard/doctor",
  requireAuth,
  requireRole("DOCTOR"),
  (req, res) => {
    const doctor = db.prepare(`
        SELECT d.*, u.full_name, u.email, u.phone
        FROM doctors d JOIN users u ON u.id = d.user_id
        WHERE d.user_id = ?
      `).get(req.auth.userId);
    if (!doctor) {
      res.status(404).json({ error: "Doctor profile not found." });
      return;
    }
    const appointments = db.prepare(`
        SELECT a.*, pu.full_name AS patient_name, p.blood_group AS patient_blood_group
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN users pu ON pu.id = p.user_id
        WHERE a.doctor_id = ?
        ORDER BY a.scheduled_start ASC
      `).all(String(doctor.id));
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const authorizedPatientsCount = db.prepare(`
          SELECT COUNT(DISTINCT p.id) AS cnt
          FROM patients p
          WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = ?)
             OR EXISTS (SELECT 1 FROM record_sharing_permissions s WHERE s.patient_id = p.id AND s.doctor_id = ? AND s.is_active = 1 AND s.revoked_at IS NULL AND s.expires_at > ?)
        `).get(String(doctor.id), String(doctor.id), nowIso).cnt;
    const uploadedRecordsCount = db.prepare("SELECT COUNT(*) AS cnt FROM medical_records WHERE uploaded_by_doctor_id = ?").get(String(doctor.id)).cnt;
    res.json({
      profile: doctor,
      appointments,
      authorizedPatientsCount,
      uploadedRecordsCount
    });
  }
);
adminAndDashboardRouter.get(
  "/dashboard/admin",
  requireAuth,
  requireRole("ADMIN"),
  (_req, res) => {
    const totalPatients = db.prepare("SELECT COUNT(*) AS cnt FROM patients").get().cnt;
    const totalDoctors = db.prepare("SELECT COUNT(*) AS cnt FROM doctors").get().cnt;
    const totalAppointments = db.prepare("SELECT COUNT(*) AS cnt FROM appointments").get().cnt;
    const totalRecords = db.prepare("SELECT COUNT(*) AS cnt FROM medical_records").get().cnt;
    const statusCounts = db.prepare("SELECT status, COUNT(*) AS count FROM appointments GROUP BY status").all();
    const byDepartment = db.prepare(`
        SELECT d.specialization, COUNT(a.id) AS count
        FROM doctors d
        LEFT JOIN appointments a ON a.doctor_id = d.id
        GROUP BY d.specialization
        ORDER BY count DESC
      `).all();
    const emailLogs = db.prepare(`
        SELECT n.id, n.type, n.subject, n.delivery_status, n.sent_at, u.email AS recipient_email
        FROM notifications n
        JOIN users u ON u.id = n.user_id
        WHERE n.channel = 'EMAIL'
        ORDER BY n.created_at DESC
        LIMIT 15
      `).all();
    res.json({
      summary: {
        totalPatients,
        totalDoctors,
        totalAppointments,
        totalRecords,
        statusBreakdown: statusCounts
      },
      byDepartment,
      emailLogs
    });
  }
);
adminAndDashboardRouter.get(
  "/admin/users",
  requireAuth,
  requireRole("ADMIN"),
  (_req, res) => {
    const users = db.prepare(`
        SELECT u.id, u.email, u.role, u.full_name, u.phone, u.is_active, u.created_at,
               d.id AS doctor_id, d.specialization, d.license_number, d.department,
               p.id AS patient_id, p.blood_group
        FROM users u
        LEFT JOIN doctors d ON d.user_id = u.id
        LEFT JOIN patients p ON p.user_id = u.id
        ORDER BY u.created_at DESC
      `).all();
    res.json({ users });
  }
);
var userStatusSchema = z5.object({
  isActive: z5.boolean()
});
adminAndDashboardRouter.patch(
  "/admin/users/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  (req, res, next) => {
    try {
      const { isActive } = userStatusSchema.parse(req.body);
      if (req.params.id === req.auth.userId && !isActive) {
        res.status(400).json({ error: "Cannot deactivate your own active administrator account." });
        return;
      }
      const target = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.params.id);
      if (!target) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").run(
        isActive ? 1 : 0,
        (/* @__PURE__ */ new Date()).toISOString(),
        target.id
      );
      recordAuditLog({
        actorUserId: req.auth.userId,
        action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
        resourceType: "User",
        resourceId: target.id,
        ipAddress: req.ip
      });
      res.json({ ok: true, isActive });
    } catch (err) {
      next(err);
    }
  }
);
adminAndDashboardRouter.get(
  "/admin/audit-logs",
  requireAuth,
  requireRole("ADMIN"),
  (_req, res) => {
    const logs = db.prepare(`
        SELECT a.*, u.full_name AS actor_name, u.email AS actor_email, u.role AS actor_role
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC
        LIMIT 100
      `).all();
    res.json({ logs });
  }
);
adminAndDashboardRouter.post(
  "/admin/run-reminders",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res, next) => {
    try {
      const result = await run24HourReminderSweep();
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// server.ts
async function bootstrap() {
  seedDatabaseIfEmpty();
  startReminderWorker();
  const app = express2();
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false
    })
  );
  const apiLimiter = rateLimit({
    windowMs: 60 * 1e3,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment and try again." }
  });
  app.use("/api", apiLimiter);
  app.use(cookieParser());
  app.use(express2.json({ limit: "2mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "MediCloud API",
      timezone: env.tz,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.use("/api/auth", authRouter);
  app.use("/api", directoryRouter);
  app.use("/api/appointments", appointmentRouter);
  app.use("/api", recordsRouter);
  app.use("/api", adminAndDashboardRouter);
  app.use(errorHandler);
  if (env.nodeEnv !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path3.resolve(process.cwd(), "dist");
    app.use(express2.static(distDir));
    app.get("*", (_req, res) => {
      const indexHtml = path3.join(distDir, "index.html");
      if (fs3.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send("Build artifacts not found.");
      }
    });
  }
  app.listen(env.port, "0.0.0.0", () => {
    console.log(`[MediCloud] Server listening on http://0.0.0.0:${env.port} (${env.tz})`);
  });
}
bootstrap().catch((err) => {
  console.error("[MediCloud] Fatal startup error:", err);
  process.exit(1);
});
