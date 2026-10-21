import type { FastifyInstance } from 'fastify';
import { and, eq, sql, desc, inArray, isNull, or } from 'drizzle-orm';
import { assignmentSchema, bulkAssignmentSchema, assignmentRuleSchema, paginationSchema, PERMISSION, todayISO } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission, buildScope, type AccessScope } from '../../core/context.js';
import { NotFound, ValidationError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { employeeScopeFilter, assertEmployeeVisible } from '../employees/routes.js';

/* Назначение обучения (§16, §17 ТЗ).

   Правила назначения (assignment_rules) — декларативные условия, которые
   можно сначала посмотреть (preview), а потом применить. Это ответ на
   вопрос «кому это прилетит?» до того, как прилетит: массовое назначение
   без предпросмотра — частый способ разослать обучение не тем людям. */

interface RuleCondition { field: string; op: string; value: unknown }

/* Подбор сотрудников по условиям правила. */
async function matchEmployees(scope: AccessScope, conditions: RuleCondition[]) {
  const filters = [...employeeScopeFilter(scope), isNull(schema.users.deletedAt), eq(schema.users.isActive, true)];

  for (const cond of conditions) {
    const value = cond.value;
    const list = Array.isArray(value) ? (value as string[]) : [String(value)];
    switch (cond.field) {
      case 'department':
        filters.push(inArray(schema.employeeProfiles.departmentId, list));
        break;
      case 'position':
        filters.push(inArray(schema.employeeProfiles.positionId, list));
        break;
      case 'profession':
        filters.push(inArray(schema.employeeProfiles.professionId, list));
        break;
      case 'group':
        filters.push(inArray(schema.employeeProfiles.employeeGroup, list));
        break;
      case 'employee':
        filters.push(inArray(schema.employeeProfiles.id, list));
        break;
      case 'qualification':
        filters.push(inArray(schema.employeeProfiles.qualification, list));
        break;
      case 'experience': {
        const months = Number(value) || 0;
        filters.push(cond.op === 'lte'
          ? sql`coalesce(${schema.employeeProfiles.experienceMonths}, 0) <= ${months}`
          : sql`coalesce(${schema.employeeProfiles.experienceMonths}, 0) >= ${months}`);
        break;
      }
      case 'permit':
        filters.push(sql`exists (select 1 from employee_permits p where p.employee_id = ${schema.employeeProfiles.id}
          and p.status = 'active' and p.permit_type = ${String(value)})`);
        break;
    }
  }

  return db.select({
      id: schema.employeeProfiles.id,
      fullName: schema.users.fullName,
      departmentId: schema.employeeProfiles.departmentId,
    })
    .from(schema.employeeProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
    .where(and(...filters));
}

export async function assignmentsRoutes(app: FastifyInstance) {
  app.get('/api/assignments',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN, PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const q = paginationSchema.parse(request.query);
      const query = request.query as { training?: string; employee?: string; status?: string; overdue?: string };
      const scope = await buildScope(request.user);

      const filters = [eq(schema.assignments.organizationId, request.user.organizationId)];
      if (query.training) filters.push(eq(schema.assignments.trainingId, query.training));
      if (query.employee) filters.push(eq(schema.assignments.employeeId, query.employee));
      if (query.status) filters.push(eq(schema.assignments.status, query.status));
      if (query.overdue === 'true') {
        filters.push(sql`${schema.assignments.dueDate} < current_date
          and ${schema.assignments.status} not in ('completed','cancelled')`);
      }
      if (!scope.isAdmin && scope.departmentIds !== null) {
        filters.push(scope.departmentIds.length
          ? inArray(schema.employeeProfiles.departmentId, scope.departmentIds) : sql`false`);
      }
      const where = and(...filters);

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.assignments)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.assignments.employeeId))
        .where(where);

      const rows = await db.select({
          assignment: schema.assignments,
          employeeName: schema.users.fullName,
          departmentName: schema.departments.name,
          trainingTitle: schema.trainingBlocks.title,
        })
        .from(schema.assignments)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.assignments.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .leftJoin(schema.departments, eq(schema.departments.id, schema.employeeProfiles.departmentId))
        .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.assignments.trainingId))
        .where(where)
        .orderBy(desc(schema.assignments.assignedAt))
        .limit(q.limit).offset((q.page - 1) * q.limit);

      return paginated(rows, q.page, q.limit, count);
    });

  app.post('/api/assignments',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const body = assignmentSchema.parse(request.body);
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, body.employeeId);

      /* Повторное назначение не создаёт дубль — обновляет срок и приоритет. */
      const [created] = await db.insert(schema.assignments).values({
        organizationId: request.user.organizationId,
        trainingId: body.trainingId,
        employeeId: body.employeeId,
        assignedBy: request.user.userId,
        dueDate: body.dueDate || null,
        priority: body.priority,
        isRequired: body.isRequired,
      }).onConflictDoUpdate({
        target: [schema.assignments.employeeId, schema.assignments.trainingId],
        set: { dueDate: body.dueDate || null, priority: body.priority, isRequired: body.isRequired, updatedAt: new Date() },
      }).returning();

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'assignment_created',
        entityType: 'assignment', entityId: created.id, details: `срок ${body.dueDate || 'не задан'}` });
      return ok(created);
    });

  /* Массовое назначение по подразделениям, должностям, профессиям. */
  app.post('/api/assignments/bulk',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const body = bulkAssignmentSchema.parse(request.body);
      const scope = await buildScope(request.user);

      const conditions: RuleCondition[] = [];
      const t = body.targets;
      const orGroups: Array<{ id: string }[]> = [];

      for (const [field, values] of [
        ['employee', t.employeeIds], ['department', t.departmentIds],
        ['position', t.positionIds], ['profession', t.professionIds], ['group', t.groups],
      ] as const) {
        if (values.length) orGroups.push(await matchEmployees(scope, [{ field, op: 'in', value: values }]));
      }

      if (orGroups.length === 0) throw ValidationError('Не выбрано ни одного получателя.');

      const unique = new Map<string, { id: string }>();
      for (const group of orGroups) for (const e of group) unique.set(e.id, e);
      const employees = [...unique.values()];

      if (employees.length === 0) {
        return ok({ assigned: 0, employees: [], message: 'Под условия не подошёл ни один сотрудник.' });
      }

      await db.insert(schema.assignments).values(
        employees.map((e) => ({
          organizationId: request.user.organizationId,
          trainingId: body.trainingId,
          employeeId: e.id,
          assignedBy: request.user.userId,
          dueDate: body.dueDate || null,
          priority: body.priority,
          isRequired: body.isRequired,
        })),
      ).onConflictDoUpdate({
        target: [schema.assignments.employeeId, schema.assignments.trainingId],
        set: { dueDate: body.dueDate || null, priority: body.priority, updatedAt: new Date() },
      });

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'assignment_bulk',
        entityType: 'training', entityId: body.trainingId,
        details: `назначено ${employees.length} сотрудникам` });

      return ok({ assigned: employees.length, employeeIds: employees.map((e) => e.id) });
    });

  app.patch('/api/assignments/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { dueDate?: string; priority?: string; status?: string; isRequired?: boolean };
      const [updated] = await db.update(schema.assignments).set({
          dueDate: body.dueDate !== undefined ? body.dueDate || null : undefined,
          priority: body.priority, status: body.status, isRequired: body.isRequired, updatedAt: new Date(),
        })
        .where(and(eq(schema.assignments.id, id), eq(schema.assignments.organizationId, request.user.organizationId)))
        .returning();
      if (!updated) throw NotFound('Назначение не найдено.');
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'assignment_updated', entityType: 'assignment', entityId: id });
      return ok(updated);
    });

  app.delete('/api/assignments/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const { id } = request.params as { id: string };
      /* Если по обучению уже есть попытки, назначение отменяется, а не
         удаляется: иначе результаты повиснут без основания. */
      const rows = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id)).limit(1);
      if (!rows[0]) throw NotFound('Назначение не найдено.');
      const [{ attempts }] = await db.select({ attempts: sql<number>`count(*)::int` })
        .from(schema.testAttempts).where(eq(schema.testAttempts.assignmentId, id));

      if (attempts > 0) {
        await db.update(schema.assignments).set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(schema.assignments.id, id));
        return ok({ deleted: false, cancelled: true, reason: 'По назначению есть попытки — оно отменено, а не удалено.' });
      }
      await db.delete(schema.assignments).where(eq(schema.assignments.id, id));
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'assignment_deleted', entityType: 'assignment', entityId: id });
      return ok({ deleted: true });
    });

  /* ---------- Правила назначения ---------- */

  app.get('/api/assignment-rules',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const rows = await db.select({ rule: schema.assignmentRules, trainingTitle: schema.trainingBlocks.title })
        .from(schema.assignmentRules)
        .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.assignmentRules.trainingId))
        .where(eq(schema.assignmentRules.organizationId, request.user.organizationId));
      return ok(rows);
    });

  app.post('/api/assignment-rules',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const body = assignmentRuleSchema.parse(request.body);
      const [created] = await db.insert(schema.assignmentRules).values({
        organizationId: request.user.organizationId,
        trainingId: body.trainingId,
        name: body.name,
        conditions: body.conditions as object,
        dueDays: body.dueDays ?? null,
        priority: body.priority,
        isActive: body.isActive,
        createdBy: request.user.userId,
      }).returning();
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'assignment_rule_created',
        entityType: 'rule', entityId: created.id, details: body.name });
      return ok(created);
    });

  /* Предпросмотр: кто попадёт под правило. Ничего не назначает. */
  app.post('/api/assignment-rules/:id/preview',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const rows = await db.select().from(schema.assignmentRules)
        .where(and(eq(schema.assignmentRules.id, id),
                   eq(schema.assignmentRules.organizationId, request.user.organizationId))).limit(1);
      if (!rows[0]) throw NotFound('Правило не найдено.');

      const scope = await buildScope(request.user);
      const conditions = (rows[0].conditions as { all: RuleCondition[] }).all ?? [];
      const employees = await matchEmployees(scope, conditions);

      const already = employees.length
        ? await db.select({ employeeId: schema.assignments.employeeId })
            .from(schema.assignments)
            .where(and(eq(schema.assignments.trainingId, rows[0].trainingId),
                       inArray(schema.assignments.employeeId, employees.map((e) => e.id))))
        : [];
      const assigned = new Set(already.map((a) => a.employeeId));

      return ok({
        matched: employees.length,
        willAssign: employees.filter((e) => !assigned.has(e.id)).length,
        alreadyAssigned: employees.filter((e) => assigned.has(e.id)).length,
        employees: employees.map((e) => ({ ...e, alreadyAssigned: assigned.has(e.id) })),
      });
    });

  app.post('/api/assignment-rules/:id/apply',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const rows = await db.select().from(schema.assignmentRules)
        .where(and(eq(schema.assignmentRules.id, id),
                   eq(schema.assignmentRules.organizationId, request.user.organizationId))).limit(1);
      const rule = rows[0];
      if (!rule) throw NotFound('Правило не найдено.');

      const scope = await buildScope(request.user);
      const conditions = (rule.conditions as { all: RuleCondition[] }).all ?? [];
      const employees = await matchEmployees(scope, conditions);
      if (employees.length === 0) return ok({ assigned: 0 });

      await db.insert(schema.assignments).values(
        employees.map((e) => ({
          organizationId: request.user.organizationId,
          trainingId: rule.trainingId,
          employeeId: e.id,
          ruleId: rule.id,
          assignedBy: request.user.userId,
          dueDate: rule.dueDays ? todayISO(rule.dueDays) : null,
          priority: rule.priority,
        })),
      ).onConflictDoNothing({ target: [schema.assignments.employeeId, schema.assignments.trainingId] });

      await db.update(schema.assignmentRules).set({ lastAppliedAt: new Date() })
        .where(eq(schema.assignmentRules.id, id));

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'assignment_rule_applied',
        entityType: 'rule', entityId: id, details: `${employees.length} сотрудников` });
      return ok({ assigned: employees.length });
    });

  app.delete('/api/assignment-rules/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_ASSIGN)] },
    async (request) => {
      const { id } = request.params as { id: string };
      await db.delete(schema.assignmentRules)
        .where(and(eq(schema.assignmentRules.id, id),
                   eq(schema.assignmentRules.organizationId, request.user.organizationId)));
      return ok({ deleted: true });
    });
}
