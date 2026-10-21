import { db, schema } from '../db/client.js';
import { redact } from './crypto.js';

/* Журнал действий на бэкенде (§61 ТЗ).
   В прототипе аудит жил в localStorage и обрезался до 400 записей —
   здесь ограничения нет, а запись нельзя подделать из браузера. */

export interface AuditEntry {
  organizationId: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: string | null;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId ?? null,
      actorLabel: entry.actorLabel ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      details: entry.details ? redact(entry.details).slice(0, 2000) : null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
    });
  } catch (e) {
    /* Аудит не должен ронять основную операцию. */
    console.error('Не удалось записать событие аудита:', redact((e as Error).message));
  }
}
