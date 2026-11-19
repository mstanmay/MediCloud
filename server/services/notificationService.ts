import crypto from 'node:crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { db } from '../db/database';
import { env, isSesConfigured } from '../config/env';

let sesClient: SESClient | null = null;
function getSesClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({ region: env.awsRegion });
  }
  return sesClient;
}

export async function dispatchNotification(params: {
  userId: string;
  recipientEmail?: string;
  appointmentId?: string | null;
  type: string;
  subject: string;
  message: string;
  sendEmail?: boolean;
}): Promise<{ inAppId: string; emailStatus: string }> {
  const nowIso = new Date().toISOString();
  const inAppId = `notif_${crypto.randomUUID().slice(0, 12)}`;

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
    nowIso,
  );

  let emailStatus = 'SKIPPED';
  if (params.sendEmail && params.recipientEmail) {
    const emailLogId = `notif_${crypto.randomUUID().slice(0, 12)}`;
    if (isSesConfigured()) {
      try {
        await getSesClient().send(
          new SendEmailCommand({
            Source: env.awsSesFromEmail,
            Destination: { ToAddresses: [params.recipientEmail] },
            Message: {
              Subject: { Data: params.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: params.message, Charset: 'UTF-8' } },
            },
          }),
        );
        emailStatus = 'SENT_VIA_AWS_SES';
      } catch (err) {
        console.error('[SES] Email dispatch failed, logged for retry:', err);
        emailStatus = 'SES_RETRY_PENDING';
      }
    } else {
      emailStatus = 'SES_SANDBOX_LOGGED';
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
      nowIso,
    );
  }

  return { inAppId, emailStatus };
}
