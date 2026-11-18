import crypto from 'node:crypto';
import { db } from '../db/database';

export function recordAuditLog(params: {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): void {
  const id = `aud_${crypto.randomUUID().slice(0, 12)}`;
  const nowIso = new Date().toISOString();
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
    params.ipAddress || 'unknown',
    nowIso,
  );
}
