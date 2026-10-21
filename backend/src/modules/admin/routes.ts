import type { FastifyInstance } from 'fastify';
import { and, eq, sql, desc, isNull, inArray } from 'drizzle-orm';
import { platformSettingsSchema, PERMISSION, AUDIT_LABELS, validityStatus } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission, buildScope } from '../../core/context.js';
import { logAudit } from '../../core/audit.js';

/* Сводки и настройки платформы (§11, §31, §32 ТЗ). */

export async function adminRoutes(app: FastifyInstance) {
  /* Dashboard администратора: состояние системы одним запросом. */
  app.get('/api/admin/dashboard',
    { onRequest: [requireAuth, requirePermission(PERMISSION.SETTINGS_MANAGE, PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const orgId = request.user.organizationId;

      const [users, employees, trainings, attempts, certs, aiReqs] = await Promise.all([
        db.select({
            total: sql<number>`count(*)::int`,
            active: sql<number>`count(*) filter (where ${schema.users.isActive})::int`,
          }).from(schema.users)
          .where(and(eq(schema.users.organizationId, orgId), isNull(schema.users.deletedAt))),
        db.select({ total: sql<number>`count(*)::int` }).from(schema.employeeProfiles)
          .where(eq(schema.employeeProfiles.organizationId, orgId)),
        db.select({
            total: sql<number>`count(*)::int`,
            published: sql<number>`count(*) filter (where ${schema.trainingBlocks.status} = 'published')::int`,
          }).from(schema.trainingBlocks)
          .where(and(eq(schema.trainingBlocks.organizationId, orgId), isNull(schema.trainingBlocks.deletedAt))),
        db.select({
            total: sql<number>`count(*)::int`,
            passed: sql<number>`count(*) filter (where ${schema.testAttempts.passed})::int`,
            avgScore: sql<number>`coalesce(round(avg(${schema.testAttempts.score})), 0)::int`,
            last7: sql<number>`count(*) filter (where ${schema.testAttempts.finishedAt} > now() - interval '7 days')::int`,
          }).from(schema.testAttempts)
          .where(and(eq(schema.testAttempts.organizationId, orgId), sql`${schema.testAttempts.finishedAt} is not null`)),
        db.select({
            active: sql<number>`count(*) filter (where ${schema.certificates.status} = 'active')::int`,
            expiring: sql<number>`count(*) filter (where ${schema.certificates.validUntil} between current_date and current_date + interval '30 days')::int`,
          }).from(schema.certificates).where(eq(schema.certificates.organizationId, orgId)),
        db.select({
            total: sql<number>`count(*)::int`,
            errors: sql<number>`count(*) filter (where ${schema.aiRequests.status} = 'error')::int`,
          }).from(schema.aiRequests).where(eq(schema.aiRequests.organizationId, orgId)),
      ]);

      const overdue = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.assignments)
        .where(and(eq(schema.assignments.organizationId, orgId),
                   sql`${schema.assignments.dueDate} < current_date`,
                   sql`${schema.assignments.status} not in ('completed','cancelled')`));

      const recentAudit = await db.select().from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId))
        .orderBy(desc(schema.auditLogs.createdAt)).limit(15);

      const integration = await db.select().from(schema.integrations)
        .where(and(eq(schema.integrations.organizationId, orgId), eq(schema.integrations.kind, '1c'))).limit(1);

      const aiSettings = await db.select().from(schema.aiSettings)
        .where(eq(schema.aiSettings.organizationId, orgId)).limit(1);

      return ok({
        users: users[0],
        employees: employees[0],
        trainings: trainings[0],
        attempts: attempts[0],
        certificates: certs[0],
        overdueAssignments: overdue[0].count,
        ai: { ...aiReqs[0], enabled: aiSettings[0]?.enabled ?? false },
        integration: integration[0]
          ? { configured: true, isEnabled: integration[0].isEnabled,
              lastSyncAt: integration[0].lastSyncAt, lastStatus: integration[0].lastStatus }
          : { configured: false },
        recentAudit: recentAudit.map((r) => ({ ...r, actionLabel: AUDIT_LABELS[r.action] ?? r.action })),
      });
    });

  /* Сводка руководителя (§31 ТЗ): фокус на людях в его зоне. */
  app.get('/api/manager/dashboard',
    { onRequest: [requireAuth, requirePermission(PERMISSION.REPORTS_VIEW, PERMISSION.EMPLOYEE_VIEW)] },
    async (request) => {
      const orgId = request.user.organizationId;
      const scope = await buildScope(request.user);

      const deptFilter = !scope.isAdmin && scope.departmentIds !== null
        ? (scope.departmentIds.length ? inArray(schema.employeeProfiles.departmentId, scope.departmentIds) : sql`false`)
        : sql`true`;

      const settings = await db.select().from(schema.platformSettings)
        .where(eq(schema.platformSettings.organizationId, orgId)).limit(1);
      const inactivityDays = settings[0]?.inactivityDays ?? 21;
      const failThreshold = settings[0]?.repeatedFailureThreshold ?? 2;

      const employees = await db.select({
          total: sql<number>`count(*)::int`,
          inactive: sql<number>`count(*) filter (where ${schema.employeeProfiles.lastActivityAt} is null
            or ${schema.employeeProfiles.lastActivityAt} < now() - (${inactivityDays} || ' days')::interval)::int`,
        })
        .from(schema.employeeProfiles)
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .where(and(eq(schema.employeeProfiles.organizationId, orgId), isNull(schema.users.deletedAt), deptFilter));

      const assignments = await db.select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${schema.assignments.status} = 'completed')::int`,
          overdue: sql<number>`count(*) filter (where ${schema.assignments.dueDate} < current_date
            and ${schema.assignments.status} not in ('completed','cancelled'))::int`,
          dueSoon: sql<number>`count(*) filter (where ${schema.assignments.dueDate}
            between current_date and current_date + interval '7 days'
            and ${schema.assignments.status} not in ('completed','cancelled'))::int`,
        })
        .from(schema.assignments)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.assignments.employeeId))
        .where(and(eq(schema.assignments.organizationId, orgId), deptFilter));

      /* Кто не сдал одно и то же несколько раз подряд — им нужна помощь,
         а не ещё одно напоминание (§31 ТЗ). */
      const strugglingRows = await db.select({
          employeeId: schema.testAttempts.employeeId,
          employeeName: schema.users.fullName,
          moduleTitle: schema.trainingModuleVersions.title,
          failures: sql<number>`count(*)::int`,
        })
        .from(schema.testAttempts)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.testAttempts.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .innerJoin(schema.trainingModuleVersions, eq(schema.trainingModuleVersions.id, schema.testAttempts.moduleVersionId))
        .where(and(eq(schema.testAttempts.organizationId, orgId),
                   eq(schema.testAttempts.passed, false), deptFilter))
        .groupBy(schema.testAttempts.employeeId, schema.users.fullName, schema.trainingModuleVersions.title)
        .having(sql`count(*) >= ${failThreshold}`)
        .limit(20);

      const expiringCerts = await db.select({
          certificate: schema.certificates,
          employeeName: schema.users.fullName,
          trainingTitle: schema.trainingBlocks.title,
        })
        .from(schema.certificates)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.certificates.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.certificates.trainingId))
        .where(and(eq(schema.certificates.organizationId, orgId),
                   eq(schema.certificates.status, 'active'),
                   sql`${schema.certificates.validUntil} between current_date and current_date + (${settings[0]?.certWarningDays ?? 30} || ' days')::interval`,
                   deptFilter))
        .limit(20);

      return ok({
        employees: employees[0],
        assignments: assignments[0],
        struggling: strugglingRows,
        expiringCertificates: expiringCerts.map((c) => ({ ...c, validity: validityStatus(c.certificate.validUntil) })),
      });
    });

  app.get('/api/settings',
    { onRequest: [requireAuth, requirePermission(PERMISSION.SETTINGS_MANAGE)] },
    async (request) => {
      const rows = await db.select().from(schema.platformSettings)
        .where(eq(schema.platformSettings.organizationId, request.user.organizationId)).limit(1);
      return ok(rows[0] ?? { organizationId: request.user.organizationId });
    });

  app.put('/api/settings',
    { onRequest: [requireAuth, requirePermission(PERMISSION.SETTINGS_MANAGE)] },
    async (request) => {
      const body = platformSettingsSchema.parse(request.body);
      await db.insert(schema.platformSettings)
        .values({ organizationId: request.user.organizationId, ...body })
        .onConflictDoUpdate({
          target: schema.platformSettings.organizationId,
          set: { ...body, updatedAt: new Date() },
        });
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'settings_change', details: 'настройки платформы' });
      return ok({ saved: true });
    });
}
