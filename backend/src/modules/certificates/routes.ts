import type { FastifyInstance } from 'fastify';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { certificateSchema, permitSchema, paginationSchema, PERMISSION, validityStatus, todayISO } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission, buildScope } from '../../core/context.js';
import { NotFound, ValidationError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { assertEmployeeVisible } from '../employees/routes.js';

/* Сертификаты и допуски (§38 ТЗ).
   Сертификат обычно выдаётся автоматически при завершении программы
   (см. testing/service.ts). Ручная выдача оставлена для случаев,
   когда обучение прошло вне системы. */

export async function certificatesRoutes(app: FastifyInstance) {
  app.get('/api/certificates',
    { onRequest: [requireAuth, requirePermission(PERMISSION.CERTIFICATE_ISSUE, PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const q = paginationSchema.parse(request.query);
      const query = request.query as { status?: string; expiring?: string; employee?: string };
      const scope = await buildScope(request.user);

      const filters = [eq(schema.certificates.organizationId, request.user.organizationId)];
      if (query.status) filters.push(eq(schema.certificates.status, query.status));
      if (query.employee) filters.push(eq(schema.certificates.employeeId, query.employee));
      if (query.expiring === 'true') {
        filters.push(sql`${schema.certificates.validUntil} between current_date and current_date + interval '30 days'`);
      }
      if (!scope.isAdmin && scope.departmentIds !== null) {
        filters.push(scope.departmentIds.length
          ? inArray(schema.employeeProfiles.departmentId, scope.departmentIds) : sql`false`);
      }
      const where = and(...filters);

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.certificates)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.certificates.employeeId))
        .where(where);

      const rows = await db.select({
          certificate: schema.certificates,
          employeeName: schema.users.fullName,
          trainingTitle: schema.trainingBlocks.title,
        })
        .from(schema.certificates)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.certificates.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.certificates.trainingId))
        .where(where).orderBy(desc(schema.certificates.issuedAt))
        .limit(q.limit).offset((q.page - 1) * q.limit);

      return paginated(rows.map((r) => ({ ...r, validity: validityStatus(r.certificate.validUntil) })),
        q.page, q.limit, count);
    });

  app.post('/api/certificates',
    { onRequest: [requireAuth, requirePermission(PERMISSION.CERTIFICATE_ISSUE)] },
    async (request) => {
      const body = certificateSchema.parse(request.body);
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, body.employeeId);

      const number = `TB-MAN-${Date.now().toString(36).toUpperCase()}`;
      const [created] = await db.insert(schema.certificates).values({
        organizationId: request.user.organizationId,
        employeeId: body.employeeId,
        trainingId: body.trainingId,
        trainingVersionKey: `manual:${Date.now()}`,
        number,
        score: body.score ?? null,
        issuedAt: todayISO(0),
        issuedBy: request.user.userId,
        validUntil: body.validUntil || null,
      }).returning();

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'certificate_issued',
        entityType: 'certificate', entityId: created.id, details: number });
      return ok(created);
    });

  app.post('/api/certificates/:id/revoke',
    { onRequest: [requireAuth, requirePermission(PERMISSION.CERTIFICATE_ISSUE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { reason?: string };
      if (!body.reason?.trim()) throw ValidationError('Укажите причину отзыва сертификата.');
      const [updated] = await db.update(schema.certificates)
        .set({ status: 'revoked', revokedAt: new Date(), revokeReason: body.reason })
        .where(and(eq(schema.certificates.id, id),
                   eq(schema.certificates.organizationId, request.user.organizationId))).returning();
      if (!updated) throw NotFound('Сертификат не найден.');
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'certificate_revoked',
        entityType: 'certificate', entityId: id, details: body.reason });
      return ok(updated);
    });

  /* Публичная проверка сертификата по номеру (§38 ТЗ).
     Отдаёт минимум: подлинность и срок, без персональных данных. */
  app.get('/api/certificates/verify/:number', async (request) => {
    const { number } = request.params as { number: string };
    const rows = await db.select({
        number: schema.certificates.number,
        issuedAt: schema.certificates.issuedAt,
        validUntil: schema.certificates.validUntil,
        status: schema.certificates.status,
        trainingTitle: schema.trainingBlocks.title,
        organizationName: schema.organizations.name,
      })
      .from(schema.certificates)
      .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.certificates.trainingId))
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.certificates.organizationId))
      .where(eq(schema.certificates.number, number)).limit(1);

    if (!rows[0]) return ok({ found: false });
    return ok({ found: true, ...rows[0], validity: validityStatus(rows[0].validUntil) });
  });

  /* ---------- Допуски ---------- */

  app.get('/api/permits',
    { onRequest: [requireAuth, requirePermission(PERMISSION.PERMIT_ISSUE, PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const scope = await buildScope(request.user);
      const filters = [eq(schema.employeePermits.organizationId, request.user.organizationId)];
      if (!scope.isAdmin && scope.departmentIds !== null) {
        filters.push(scope.departmentIds.length
          ? inArray(schema.employeeProfiles.departmentId, scope.departmentIds) : sql`false`);
      }
      const rows = await db.select({
          permit: schema.employeePermits,
          employeeName: schema.users.fullName,
        })
        .from(schema.employeePermits)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.employeePermits.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .where(and(...filters)).orderBy(desc(schema.employeePermits.issuedAt));
      return ok(rows.map((r) => ({ ...r, validity: validityStatus(r.permit.validUntil) })));
    });

  app.post('/api/permits',
    { onRequest: [requireAuth, requirePermission(PERMISSION.PERMIT_ISSUE)] },
    async (request) => {
      const body = permitSchema.parse(request.body);
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, body.employeeId);

      const [created] = await db.insert(schema.employeePermits).values({
        organizationId: request.user.organizationId,
        employeeId: body.employeeId,
        permitType: body.permitType,
        basis: body.basis ?? null,
        certificateId: body.certificateId ?? null,
        issuedAt: body.issuedAt,
        issuedBy: request.user.userId,
        validUntil: body.validUntil || null,
      }).returning();

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'permit_issued',
        entityType: 'permit', entityId: created.id, details: body.permitType });
      return ok(created);
    });

  app.post('/api/permits/:id/revoke',
    { onRequest: [requireAuth, requirePermission(PERMISSION.PERMIT_ISSUE)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const [updated] = await db.update(schema.employeePermits).set({ status: 'revoked' })
        .where(and(eq(schema.employeePermits.id, id),
                   eq(schema.employeePermits.organizationId, request.user.organizationId))).returning();
      if (!updated) throw NotFound('Допуск не найден.');
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'permit_revoked', entityType: 'permit', entityId: id });
      return ok(updated);
    });
}
