import type { FastifyInstance } from 'fastify';
import { and, eq, desc, sql, gte, lte, ilike, or } from 'drizzle-orm';
import { paginationSchema, PERMISSION, AUDIT_LABELS } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission } from '../../core/context.js';

/* Журнал действий. В прототипе он жил в localStorage и терялся вместе с
   браузером; здесь запись делает сервер и подделать её из интерфейса нельзя. */

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AUDIT_VIEW)] },
    async (request) => {
      const q = paginationSchema.parse(request.query);
      const query = request.query as { action?: string; actor?: string; from?: string; to?: string; entityType?: string };

      const filters = [eq(schema.auditLogs.organizationId, request.user.organizationId)];
      if (query.action) filters.push(eq(schema.auditLogs.action, query.action));
      if (query.actor) filters.push(eq(schema.auditLogs.actorUserId, query.actor));
      if (query.entityType) filters.push(eq(schema.auditLogs.entityType, query.entityType));
      if (query.from) filters.push(gte(schema.auditLogs.createdAt, new Date(query.from)));
      if (query.to) filters.push(lte(schema.auditLogs.createdAt, new Date(`${query.to}T23:59:59`)));
      if (q.search) {
        filters.push(or(ilike(schema.auditLogs.details, `%${q.search}%`),
                        ilike(schema.auditLogs.actorLabel, `%${q.search}%`))!);
      }
      const where = and(...filters);

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.auditLogs).where(where);

      const rows = await db.select().from(schema.auditLogs)
        .where(where).orderBy(desc(schema.auditLogs.createdAt))
        .limit(q.limit).offset((q.page - 1) * q.limit);

      return paginated(
        rows.map((r) => ({ ...r, actionLabel: AUDIT_LABELS[r.action] ?? r.action })),
        q.page, q.limit, count,
      );
    });

  /* Справочник типов событий для фильтра. */
  app.get('/api/audit/actions',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AUDIT_VIEW)] },
    async (request) => {
      const rows = await db.select({
          action: schema.auditLogs.action,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, request.user.organizationId))
        .groupBy(schema.auditLogs.action).orderBy(desc(sql`count(*)`));
      return ok(rows.map((r) => ({ ...r, label: AUDIT_LABELS[r.action] ?? r.action })));
    });

  /* Выгрузка журнала в CSV (§61 ТЗ). */
  app.get('/api/audit/export',
    { onRequest: [requireAuth, requirePermission(PERMISSION.AUDIT_VIEW)] },
    async (request, reply) => {
      const rows = await db.select().from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, request.user.organizationId))
        .orderBy(desc(schema.auditLogs.createdAt)).limit(10000);

      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        ['Дата', 'Пользователь', 'Действие', 'Объект', 'Подробности', 'IP'].map(escape).join(','),
        ...rows.map((r) => [
          r.createdAt.toISOString(), r.actorLabel ?? '',
          AUDIT_LABELS[r.action] ?? r.action, r.entityType ?? '', r.details ?? '', r.ip ?? '',
        ].map(escape).join(',')),
      ].join('\n');

      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="audit.csv"');
      /* BOM, иначе Excel открывает кириллицу неправильно. */
      return reply.send('\uFEFF' + csv);
    });
}
