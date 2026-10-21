import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql, desc, inArray, ilike, or, type SQL } from 'drizzle-orm';
import { createEmployeeSchema, updateEmployeeSchema, paginationSchema, PERMISSION, ROLE } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission, buildScope, type AccessScope } from '../../core/context.js';
import { Conflict, NotFound, Forbidden, ValidationError } from '../../core/errors.js';
import { hashPassword, generateTempPassword } from '../../core/password.js';
import { logAudit } from '../../core/audit.js';

/* Фильтр видимости сотрудников.
   Изоляция реализована здесь, а не в обработчиках: обработчик физически не
   может вернуть чужих сотрудников, потому что запрос строится через эту
   функцию (§62, §63 ТЗ). */
export function employeeScopeFilter(scope: AccessScope): SQL[] {
  const filters: SQL[] = [eq(schema.employeeProfiles.organizationId, scope.organizationId)];
  if (!scope.isAdmin && scope.departmentIds !== null) {
    if (scope.departmentIds.length === 0) {
      /* Зона пуста — сотрудников не видно вовсе. */
      filters.push(sql`false`);
    } else {
      filters.push(inArray(schema.employeeProfiles.departmentId, scope.departmentIds));
    }
  }
  return filters;
}

export async function assertEmployeeVisible(scope: AccessScope, employeeId: string) {
  const rows = await db
    .select({ id: schema.employeeProfiles.id, departmentId: schema.employeeProfiles.departmentId })
    .from(schema.employeeProfiles)
    .where(and(...employeeScopeFilter(scope), eq(schema.employeeProfiles.id, employeeId)))
    .limit(1);
  if (!rows[0]) throw NotFound('Сотрудник не найден.');
  return rows[0];
}

export async function employeesRoutes(app: FastifyInstance) {
  app.get(
    '/api/employees',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_VIEW)] },
    async (request) => {
      const q = paginationSchema.parse(request.query);
      const query = request.query as {
        department?: string; position?: string; profession?: string; status?: string; group?: string;
      };
      const scope = await buildScope(request.user);

      const filters = [...employeeScopeFilter(scope), isNull(schema.users.deletedAt)];
      if (q.search) {
        filters.push(
          or(
            ilike(schema.users.fullName, `%${q.search}%`),
            ilike(schema.users.login, `%${q.search}%`),
            ilike(schema.employeeProfiles.personnelNumber, `%${q.search}%`),
          )!,
        );
      }
      if (query.department) filters.push(eq(schema.employeeProfiles.departmentId, query.department));
      if (query.position) filters.push(eq(schema.employeeProfiles.positionId, query.position));
      if (query.profession) filters.push(eq(schema.employeeProfiles.professionId, query.profession));
      if (query.group) filters.push(eq(schema.employeeProfiles.employeeGroup, query.group));
      if (query.status === 'active') filters.push(eq(schema.users.isActive, true));
      if (query.status === 'blocked') filters.push(eq(schema.users.isActive, false));

      const where = and(...filters);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.employeeProfiles)
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .where(where);

      const rows = await db
        .select({
          id: schema.employeeProfiles.id,
          userId: schema.users.id,
          fullName: schema.users.fullName,
          login: schema.users.login,
          email: schema.users.email,
          phone: schema.users.phone,
          isActive: schema.users.isActive,
          personnelNumber: schema.employeeProfiles.personnelNumber,
          externalId: schema.employeeProfiles.externalId,
          source: schema.employeeProfiles.source,
          departmentId: schema.employeeProfiles.departmentId,
          departmentName: schema.departments.name,
          positionId: schema.employeeProfiles.positionId,
          positionName: schema.positions.name,
          professionId: schema.employeeProfiles.professionId,
          professionName: schema.professions.name,
          hiredAt: schema.employeeProfiles.hiredAt,
          qualification: schema.employeeProfiles.qualification,
          employeeGroup: schema.employeeProfiles.employeeGroup,
          lastActivityAt: schema.employeeProfiles.lastActivityAt,
        })
        .from(schema.employeeProfiles)
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .leftJoin(schema.departments, eq(schema.departments.id, schema.employeeProfiles.departmentId))
        .leftJoin(schema.positions, eq(schema.positions.id, schema.employeeProfiles.positionId))
        .leftJoin(schema.professions, eq(schema.professions.id, schema.employeeProfiles.professionId))
        .where(where)
        .orderBy(schema.users.fullName)
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);

      return paginated(rows, q.page, q.limit, count);
    },
  );

  app.post(
    '/api/employees',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_EDIT)] },
    async (request) => {
      const body = createEmployeeSchema.parse(request.body);

      const existing = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.organizationId, request.user.organizationId), eq(schema.users.login, body.login)))
        .limit(1);
      if (existing.length) throw Conflict('Этот логин уже используется. Выберите другой.');

      const roleRows = await db
        .select()
        .from(schema.roles)
        .where(
          and(
            or(eq(schema.roles.organizationId, request.user.organizationId), isNull(schema.roles.organizationId)),
            eq(schema.roles.code, ROLE.EMPLOYEE),
          ),
        )
        .limit(1);
      if (!roleRows[0]) throw ValidationError('В системе не создана роль EMPLOYEE. Выполните npm run db:seed.');

      const created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(schema.users)
          .values({
            organizationId: request.user.organizationId,
            login: body.login,
            email: body.email || null,
            phone: body.phone || null,
            fullName: body.fullName,
            passwordHash: await hashPassword(body.password),
            mustChangePassword: true,
          })
          .returning();

        await tx.insert(schema.userRoles).values({
          userId: user.id, roleId: roleRows[0].id, grantedBy: request.user.userId,
        });

        const [profile] = await tx
          .insert(schema.employeeProfiles)
          .values({
            userId: user.id,
            organizationId: request.user.organizationId,
            personnelNumber: body.personnelNumber || null,
            departmentId: body.departmentId ?? null,
            positionId: body.positionId ?? null,
            professionId: body.professionId ?? null,
            hiredAt: body.hiredAt || null,
            qualification: body.qualification || null,
            employeeGroup: body.employeeGroup || null,
          })
          .returning();

        return { user, profile };
      });

      await logAudit({
        organizationId: request.user.organizationId,
        actorUserId: request.user.userId,
        actorLabel: request.user.fullName,
        action: 'employee_created',
        entityType: 'employee',
        entityId: created.profile.id,
        details: `${body.fullName} · логин ${body.login}`,
        ip: request.ip,
      });

      return ok({ id: created.profile.id, userId: created.user.id, login: created.user.login });
    },
  );

  app.get(
    '/api/employees/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_VIEW)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, id);

      const rows = await db
        .select({
          profile: schema.employeeProfiles,
          user: schema.users,
          departmentName: schema.departments.name,
          positionName: schema.positions.name,
          professionName: schema.professions.name,
        })
        .from(schema.employeeProfiles)
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .leftJoin(schema.departments, eq(schema.departments.id, schema.employeeProfiles.departmentId))
        .leftJoin(schema.positions, eq(schema.positions.id, schema.employeeProfiles.positionId))
        .leftJoin(schema.professions, eq(schema.professions.id, schema.employeeProfiles.professionId))
        .where(eq(schema.employeeProfiles.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) throw NotFound('Сотрудник не найден.');
      const { passwordHash, ...user } = row.user;
      return ok({
        ...row.profile,
        user,
        departmentName: row.departmentName,
        positionName: row.positionName,
        professionName: row.professionName,
      });
    },
  );

  app.patch(
    '/api/employees/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, id);
      const body = updateEmployeeSchema.parse(request.body);

      const current = await db
        .select()
        .from(schema.employeeProfiles)
        .where(eq(schema.employeeProfiles.id, id))
        .limit(1);
      if (!current[0]) throw NotFound('Сотрудник не найден.');

      /* §34 ТЗ: критические данные, пришедшие из 1С, сотруднику и руководителю
         менять нельзя — иначе следующая синхронизация их перезатрёт, а до
         этого в системе будут расходящиеся сведения. */
      if (current[0].source === 'onec') {
        const locked = ['departmentId', 'positionId', 'professionId', 'hiredAt', 'personnelNumber', 'qualification'];
        const attempted = locked.filter((f) => (body as Record<string, unknown>)[f] !== undefined);
        if (attempted.length > 0) {
          throw Forbidden(
            `Эти данные приходят из 1С и меняются только там: ${attempted.join(', ')}. Измените их в 1С и выполните синхронизацию.`,
          );
        }
      }

      await db.transaction(async (tx) => {
        if (body.fullName || body.email !== undefined || body.phone !== undefined) {
          await tx
            .update(schema.users)
            .set({
              fullName: body.fullName || undefined,
              email: body.email !== undefined ? body.email || null : undefined,
              phone: body.phone !== undefined ? body.phone || null : undefined,
              updatedAt: new Date(),
            })
            .where(eq(schema.users.id, current[0].userId));
        }
        await tx
          .update(schema.employeeProfiles)
          .set({
            personnelNumber: body.personnelNumber !== undefined ? body.personnelNumber || null : undefined,
            departmentId: body.departmentId !== undefined ? body.departmentId : undefined,
            positionId: body.positionId !== undefined ? body.positionId : undefined,
            professionId: body.professionId !== undefined ? body.professionId : undefined,
            hiredAt: body.hiredAt !== undefined ? body.hiredAt || null : undefined,
            qualification: body.qualification !== undefined ? body.qualification || null : undefined,
            employeeGroup: body.employeeGroup !== undefined ? body.employeeGroup || null : undefined,
            updatedAt: new Date(),
          })
          .where(eq(schema.employeeProfiles.id, id));
      });

      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'employee_updated', entityType: 'employee', entityId: id,
      });
      return ok({ updated: true });
    },
  );

  for (const [suffix, active, action] of [
    ['block', false, 'employee_blocked'],
    ['unblock', true, 'employee_unblocked'],
  ] as const) {
    app.post(
      `/api/employees/:id/${suffix}`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_EDIT)] },
      async (request) => {
        const { id } = request.params as { id: string };
        const scope = await buildScope(request.user);
        await assertEmployeeVisible(scope, id);
        const rows = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.id, id)).limit(1);
        await db
          .update(schema.users)
          .set({ isActive: active, updatedAt: new Date() })
          .where(eq(schema.users.id, rows[0].userId));
        if (!active) {
          await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, rows[0].userId));
        }
        await logAudit({
          organizationId: request.user.organizationId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action, entityType: 'employee', entityId: id,
        });
        return ok({ id, isActive: active });
      },
    );
  }

  app.post(
    '/api/employees/:id/reset-password',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, id);
      const rows = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.id, id)).limit(1);
      const tempPassword = generateTempPassword();
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, updatedAt: new Date() })
        .where(eq(schema.users.id, rows[0].userId));
      await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, rows[0].userId));
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'employee_password_reset', entityType: 'employee', entityId: id,
      });
      return ok({ tempPassword });
    },
  );

  app.delete(
    '/api/employees/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, id);
      const rows = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.id, id)).limit(1);
      /* Мягкое удаление: на сотрудника ссылаются попытки и сертификаты,
         физическое удаление разрушило бы историю обучения. */
      await db
        .update(schema.users)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(schema.users.id, rows[0].userId));
      await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, rows[0].userId));
      await logAudit({
        organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'employee_deleted', entityType: 'employee', entityId: id,
      });
      return ok({ deleted: true });
    },
  );

  /* Сводка по обучению конкретного сотрудника. */
  app.get(
    '/api/employees/:id/progress',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_VIEW)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, id);

      const assignmentRows = await db
        .select({
          assignment: schema.assignments,
          trainingTitle: schema.trainingBlocks.title,
        })
        .from(schema.assignments)
        .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.assignments.trainingId))
        .where(eq(schema.assignments.employeeId, id));

      const attemptRows = await db
        .select()
        .from(schema.testAttempts)
        .where(eq(schema.testAttempts.employeeId, id))
        .orderBy(desc(schema.testAttempts.startedAt));

      return ok({ assignments: assignmentRows, attempts: attemptRows });
    },
  );
}
