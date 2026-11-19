import { db } from '../db/database';
import { dispatchNotification } from '../services/notificationService';
import { recordAuditLog } from '../services/auditService';
import { formatIstDateTime } from '../../src/shared/clinicRules';

interface EligibleAppointmentRow {
  id: string;
  scheduled_start: string;
  reason: string;
  patient_user_id: string;
  patient_email: string;
  patient_name: string;
  doctor_name: string;
  specialization: string;
}

export async function run24HourReminderSweep(): Promise<{
  checkedAt: string;
  remindersSent: number;
  appointmentIds: string[];
}> {
  const now = Date.now();
  const windowEndIso = new Date(now + 24 * 3600 * 1000).toISOString();
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
  `).all(nowIso, windowEndIso) as unknown as EligibleAppointmentRow[];

  const sentIds: string[] = [];

  for (const row of rows) {
    const formattedIst = formatIstDateTime(row.scheduled_start);
    const subject = `Appointment Reminder: ${row.doctor_name} (${formattedIst} IST)`;
    const message = `Hello ${row.patient_name}, this is an automated reminder for your approved ${row.specialization} appointment with ${row.doctor_name} scheduled at ${formattedIst} (Asia/Kolkata). Reason: ${row.reason}.`;

    await dispatchNotification({
      userId: row.patient_user_id,
      recipientEmail: row.patient_email,
      appointmentId: row.id,
      type: 'APPOINTMENT_REMINDER_24H',
      subject,
      message,
      sendEmail: true,
    });

    db.prepare(`
      UPDATE appointments
      SET reminder_sent_at = ?, updated_at = ?
      WHERE id = ? AND reminder_sent_at IS NULL
    `).run(nowIso, nowIso, row.id);

    recordAuditLog({
      actorUserId: null,
      action: 'REMINDER_24H_DISPATCHED',
      resourceType: 'Appointment',
      resourceId: row.id,
      metadata: { scheduledStart: row.scheduled_start, channel: 'IN_APP+EMAIL' },
      ipAddress: 'scheduler-worker',
    });

    sentIds.push(row.id);
  }

  return {
    checkedAt: nowIso,
    remindersSent: sentIds.length,
    appointmentIds: sentIds,
  };
}

let workerTimer: NodeJS.Timeout | null = null;

export function startReminderWorker(): void {
  if (workerTimer) return;
  // Initial check 5s after boot, then every 5 minutes
  setTimeout(() => {
    void run24HourReminderSweep().catch((err) => console.error('[ReminderWorker]', err));
  }, 5000);

  workerTimer = setInterval(() => {
    void run24HourReminderSweep().catch((err) => console.error('[ReminderWorker]', err));
  }, 5 * 60 * 1000);
}
