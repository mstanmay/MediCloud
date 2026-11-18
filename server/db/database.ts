import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'medicloud.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const uploadsDir = UPLOADS_DIR;

export const db = new DatabaseSync(DB_PATH);

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

function createSamplePdfBuffer(title: string, patientName: string, summary: string): Buffer {
  const cleanTitle = title.replace(/[()\\]/g, '');
  const cleanPatient = patientName.replace(/[()\\]/g, '');
  const cleanSummary = summary.replace(/[()\\]/g, '');
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
  return Buffer.from(pdf, 'utf8');
}

export function seedDatabaseIfEmpty(): void {
  const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  if (existingCount > 0) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const demoPasswordHash = bcrypt.hashSync('MediCloud@2026', 10);

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

  // Admin
  insertUser.run('usr_admin_1', 'admin@medicloud.demo', demoPasswordHash, 'ADMIN', 'Neha Kulkarni', '+91 98200 11220', nowIso, nowIso);

  // Patients
  insertUser.run('usr_pat_1', 'arjun.mehta@medicloud.demo', demoPasswordHash, 'PATIENT', 'Arjun Mehta', '+91 98111 45001', nowIso, nowIso);
  insertPatient.run(
    'pat_1',
    'usr_pat_1',
    '1993-04-18',
    'Male',
    'O+',
    'Penicillin (mild rash)',
    'Priya Mehta (+91 98111 45002)',
    '42 Indiranagar 12th Main, Bengaluru 560038',
    nowIso,
    nowIso,
  );

  insertUser.run('usr_pat_2', 'ananya.iyer@medicloud.demo', demoPasswordHash, 'PATIENT', 'Ananya Iyer', '+91 98450 22910', nowIso, nowIso);
  insertPatient.run(
    'pat_2',
    'usr_pat_2',
    '1988-09-25',
    'Female',
    'A+',
    'None known',
    'Karthik Iyer (+91 98450 22911)',
    '18 Besant Nagar Avenue, Chennai 600090',
    nowIso,
    nowIso,
  );

  // Doctors (using generated portraits!)
  insertUser.run('usr_doc_1', 'dr.kavya.sharma@medicloud.demo', demoPasswordHash, 'DOCTOR', 'Dr. Kavya Sharma', '+91 99001 30001', nowIso, nowIso);
  insertDoctor.run(
    'doc_1',
    'usr_doc_1',
    'Cardiology',
    'MCI-KAR-48219',
    'Cardiovascular Medicine',
    12,
    1200,
    'Preventive cardiology, hypertension telemetry, and non-invasive cardiac diagnostics.',
    '/src/assets/images/doctor_cardiology_portrait_1795016749598.jpg',
    nowIso,
    nowIso,
  );

  insertUser.run('usr_doc_2', 'dr.vikram.rao@medicloud.demo', demoPasswordHash, 'DOCTOR', 'Dr. Vikram Rao', '+91 99001 30002', nowIso, nowIso);
  insertDoctor.run(
    'doc_2',
    'usr_doc_2',
    'Neurology',
    'MCI-DEL-63902',
    'Neurosciences',
    14,
    1400,
    'Headache disorders, ambulatory EEG review, and chronic migraine management.',
    '/src/assets/images/doctor_neurology_portrait_1795016749455.jpg',
    nowIso,
    nowIso,
  );

  insertUser.run('usr_doc_3', 'dr.meera.nair@medicloud.demo', demoPasswordHash, 'DOCTOR', 'Dr. Meera Nair', '+91 99001 30003', nowIso, nowIso);
  insertDoctor.run(
    'doc_3',
    'usr_doc_3',
    'General Medicine',
    'MCI-KER-71204',
    'Internal & Preventive Medicine',
    9,
    800,
    'Comprehensive primary care, metabolic screening, and longitudinal wellness monitoring.',
    '/src/assets/images/doctor_pediatrics_portrait_1795016750656.jpg',
    nowIso,
    nowIso,
  );

  // Availability for Mon-Sat (days 1..6) plus Sunday morning for Dr. Meera
  for (const docId of ['doc_1', 'doc_2', 'doc_3']) {
    for (let day = 1; day <= 6; day++) {
      insertAvail.run(`avail_${docId}_${day}_am`, docId, day, '09:30', '13:00');
      insertAvail.run(`avail_${docId}_${day}_pm`, docId, day, '14:30', '17:30');
    }
  }
  insertAvail.run('avail_doc_3_0_am', 'doc_3', 0, '10:00', '12:30');

  // Appointments (past completed + upcoming tomorrow morning IST + upcoming future days)
  const pastStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  pastStart.setUTCHours(4, 30, 0, 0); // 10:00 AM IST
  const pastEnd = new Date(pastStart.getTime() + 30 * 60 * 1000);

  // Tomorrow 10:30 AM IST (05:00 UTC) - within 24h reminder window & realistic clinic hours
  const upcoming1Start = new Date(now.getTime() + 24 * 3600 * 1000);
  upcoming1Start.setUTCHours(5, 0, 0, 0);
  if (upcoming1Start.getTime() <= now.getTime()) {
    upcoming1Start.setUTCDate(upcoming1Start.getUTCDate() + 1);
  }
  const upcoming1End = new Date(upcoming1Start.getTime() + 30 * 60 * 1000);

  // +2 days 11:30 AM IST (06:00 UTC)
  const upcoming2Start = new Date(upcoming1Start.getTime() + 25 * 3600 * 1000);
  const upcoming2End = new Date(upcoming2Start.getTime() + 30 * 60 * 1000);

  // +3 days 03:00 PM IST (09:30 UTC)
  const upcoming3Start = new Date(upcoming1Start.getTime() + 52 * 3600 * 1000);
  upcoming3Start.setUTCHours(9, 30, 0, 0);
  const upcoming3End = new Date(upcoming3Start.getTime() + 30 * 60 * 1000);

  insertAppt.run(
    'appt_1',
    'pat_1',
    'doc_1',
    pastStart.toISOString(),
    pastEnd.toISOString(),
    'COMPLETED',
    'Annual ECG & blood pressure baseline evaluation',
    'Sinus rhythm normal. Continue low-sodium diet and quarterly home BP log.',
    pastStart.toISOString(),
    nowIso,
    nowIso,
  );

  insertAppt.run(
    'appt_2',
    'pat_1',
    'doc_1',
    upcoming1Start.toISOString(),
    upcoming1End.toISOString(),
    'APPROVED',
    'Follow-up lipid panel & resting heart rate review',
    null,
    null, // Eligible for 24h reminder worker!
    nowIso,
    nowIso,
  );

  insertAppt.run(
    'appt_3',
    'pat_1',
    'doc_2',
    upcoming2Start.toISOString(),
    upcoming2End.toISOString(),
    'REQUESTED',
    'Recurring tension headache consultation',
    null,
    null,
    nowIso,
    nowIso,
  );

  insertAppt.run(
    'appt_4',
    'pat_2',
    'doc_3',
    upcoming3Start.toISOString(),
    upcoming3End.toISOString(),
    'APPROVED',
    'Quarterly HbA1c and thyroid profile follow-up',
    null,
    null,
    nowIso,
    nowIso,
  );

  // Sample Medical Records with real PDF files on disk
  const rec1Key = 'records/pat_1/ecg_baseline_2026.pdf';
  const rec1Buf = createSamplePdfBuffer(
    '12-Lead ECG & Lipid Panel',
    'Arjun Mehta',
    'Normal sinus rhythm at 68 bpm. Total cholesterol 174 mg/dL, LDL 96 mg/dL.',
  );
  fs.mkdirSync(path.dirname(path.join(UPLOADS_DIR, rec1Key)), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, rec1Key), rec1Buf);
  const rec1Sha = crypto.createHash('sha256').update(rec1Buf).digest('hex');

  insertRecord.run(
    'rec_1',
    'pat_1',
    'doc_1',
    'appt_1',
    '12-Lead ECG & Lipid Profile',
    'Cardiology Lab',
    'arjun_ecg_lipid_2026.pdf',
    rec1Buf.length,
    rec1Key,
    rec1Sha,
    'Baseline cardiovascular assessment within reference range.',
    nowIso,
  );

  const rec2Key = 'records/pat_1/cbc_metabolic_2026.pdf';
  const rec2Buf = createSamplePdfBuffer(
    'Comprehensive Metabolic Panel',
    'Arjun Mehta',
    'Fasting glucose 92 mg/dL, Hemoglobin 14.8 g/dL, Vitamin D 34 ng/mL.',
  );
  fs.writeFileSync(path.join(UPLOADS_DIR, rec2Key), rec2Buf);
  const rec2Sha = crypto.createHash('sha256').update(rec2Buf).digest('hex');

  insertRecord.run(
    'rec_2',
    'pat_1',
    'doc_3',
    null,
    'Annual Metabolic & CBC Panel',
    'Pathology',
    'arjun_metabolic_cbc_2026.pdf',
    rec2Buf.length,
    rec2Key,
    rec2Sha,
    'Routine preventive lab workup; all parameters nominal.',
    nowIso,
  );

  const rec3Key = 'records/pat_2/thyroid_hba1c_2026.pdf';
  const rec3Buf = createSamplePdfBuffer(
    'Thyroid & HbA1c Screening',
    'Ananya Iyer',
    'TSH 2.3 mIU/L, HbA1c 5.4%. Maintain current hydration and walking routine.',
  );
  fs.mkdirSync(path.dirname(path.join(UPLOADS_DIR, rec3Key)), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, rec3Key), rec3Buf);
  const rec3Sha = crypto.createHash('sha256').update(rec3Buf).digest('hex');

  insertRecord.run(
    'rec_3',
    'pat_2',
    'doc_3',
    'appt_4',
    'Thyroid & HbA1c Screening',
    'Endocrinology Lab',
    'ananya_thyroid_hba1c_2026.pdf',
    rec3Buf.length,
    rec3Key,
    rec3Sha,
    'Glycemic and thyroid indices stable.',
    nowIso,
  );

  // Sample Consent Share (Arjun shares ECG with Dr. Vikram Rao for 14 days)
  const shareExpiry = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();
  insertShare.run('share_1', 'rec_1', 'pat_1', 'doc_2', nowIso, shareExpiry);

  // Notifications
  insertNotification.run(
    'notif_1',
    'usr_pat_1',
    'appt_2',
    'APPOINTMENT_APPROVED',
    'Appointment Approved — Dr. Kavya Sharma',
    'Your Cardiology follow-up has been approved for your selected Asia/Kolkata slot.',
    0,
    nowIso,
    nowIso,
  );
  insertNotification.run(
    'notif_2',
    'usr_pat_1',
    null,
    'MEDICAL_RECORD_UPLOADED',
    'New Medical Report Available',
    'Dr. Kavya Sharma uploaded "12-Lead ECG & Lipid Profile" to your encrypted vault.',
    0,
    nowIso,
    nowIso,
  );
  insertNotification.run(
    'notif_3',
    'usr_doc_2',
    'appt_3',
    'APPOINTMENT_REQUESTED',
    'New Appointment Request — Arjun Mehta',
    'Arjun Mehta requested a Neurology consultation. Review and approve or decline in your queue.',
    0,
    nowIso,
    nowIso,
  );

  // Initial Audit Logs
  insertAudit.run(
    'aud_1',
    'usr_doc_1',
    'MEDICAL_RECORD_UPLOADED',
    'MedicalRecord',
    'rec_1',
    JSON.stringify({ patientId: 'pat_1', title: '12-Lead ECG & Lipid Profile' }),
    nowIso,
  );
  insertAudit.run(
    'aud_2',
    'usr_pat_1',
    'RECORD_CONSENT_GRANTED',
    'RecordSharingPermission',
    'share_1',
    JSON.stringify({ recordId: 'rec_1', doctorId: 'doc_2' }),
    nowIso,
  );
}
