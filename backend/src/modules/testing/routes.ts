import type { FastifyInstance } from 'fastify';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { startAttemptSchema, finishAttemptSchema, paginationSchema, PERMISSION } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok, paginated } from '../../core/response.js';
import { requireAuth, requirePermission, buildScope } from '../../core/context.js';
import { NotFound, Forbidden, ValidationError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { assertEmployeeVisible, employeeScopeFilter } from '../employees/routes.js';
import * as service from './service.js';

export async function testingRoutes(app: FastifyInstance) {
  /* Начать попытку. Доступно только самому сотруднику. */
  app.post('/api/testing/attempts', { onRequest: requireAuth }, async (request) => {
    if (!request.user.employeeId) throw Forbidden('Тесты проходят только сотрудники.');
    const body = startAttemptSchema.parse(request.body);
    const result = await service.startAttempt({
      employeeId: request.user.employeeId,
      organizationId: request.user.organizationId,
      moduleId: body.moduleId,
      accessCode: body.accessCode,
      actor: { userId: request.user.userId, fullName: request.user.fullName },
    });
    return ok(result);
  });

  app.post('/api/testing/attempts/:id/finish', { onRequest: requireAuth }, async (request) => {
    if (!request.user.employeeId) throw Forbidden('Тесты проходят только сотрудники.');
    const { id } = request.params as { id: string };
    const body = finishAttemptSchema.parse(request.body);
    const result = await service.finishAttempt({
      attemptId: id,
      employeeId: request.user.employeeId,
      organizationId: request.user.organizationId,
      answers: body.answers,
      actor: { userId: request.user.userId, fullName: request.user.fullName },
    });
    return ok(result);
  });

  /* Разбор ошибок доступен только после завершения попытки. */
  app.get('/api/testing/attempts/:id/review', { onRequest: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const rows = await db.select().from(schema.testAttempts)
      .where(eq(schema.testAttempts.id, id)).limit(1);
    const attempt = rows[0];
    if (!attempt) throw NotFound('Попытка не найдена.');

    const isOwner = attempt.employeeId === request.user.employeeId;
    const canView = request.user.permissions.includes(PERMISSION.REPORTS_VIEW);
    if (!isOwner && !canView) throw Forbidden('Нет доступа к этой попытке.');
    if (!attempt.finishedAt) throw ValidationError('Попытка ещё не завершена.');

    const answers = await db.select().from(schema.testAnswers)
      .where(eq(schema.testAnswers.attemptId, id)).orderBy(schema.testAnswers.questionIndex);

    const questionIds = answers.map((a) => a.questionId);
    const questionRows = questionIds.length
      ? await db.select().from(schema.questions).where(inArray(schema.questions.id, questionIds))
      : [];
    const optionRows = questionIds.length
      ? await db.select().from(schema.questionOptions)
          .where(inArray(schema.questionOptions.questionId, questionIds))
          .orderBy(schema.questionOptions.sortOrder)
      : [];

    const qById = new Map(questionRows.map((q) => [q.id, q]));
    return ok({
      attempt,
      review: answers.map((a) => {
        const q = qById.get(a.questionId);
        const options = optionRows.filter((o) => o.questionId === a.questionId);
        return {
          questionId: a.questionId,
          questionText: q?.text ?? '',
          isCorrect: a.isCorrect,
          givenOptionIds: a.givenOptionIds,
          correctOptionIds: options.filter((o) => o.isCorrect).map((o) => o.id),
          explanation: q?.explanation ?? null,
          sourceReference: q?.sourceReference ?? null,
          options: options.map((o) => ({ id: o.id, text: o.text })),
        };
      }),
    });
  });

  /* Результаты для руководителя. */
  app.get('/api/testing/attempts',
    { onRequest: [requireAuth, requirePermission(PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const q = paginationSchema.parse(request.query);
      const query = request.query as { employee?: string; module?: string; passed?: string };
      const scope = await buildScope(request.user);

      const filters = [eq(schema.testAttempts.organizationId, request.user.organizationId),
        sql`${schema.testAttempts.finishedAt} is not null`];
      if (query.employee) filters.push(eq(schema.testAttempts.employeeId, query.employee));
      if (query.module) filters.push(eq(schema.testAttempts.moduleId, query.module));
      if (query.passed === 'true') filters.push(eq(schema.testAttempts.passed, true));
      if (query.passed === 'false') filters.push(eq(schema.testAttempts.passed, false));
      if (!scope.isAdmin && scope.departmentIds !== null) {
        filters.push(scope.departmentIds.length
          ? inArray(schema.employeeProfiles.departmentId, scope.departmentIds)
          : sql`false`);
      }
      const where = and(...filters);

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.testAttempts)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.testAttempts.employeeId))
        .where(where);

      const rows = await db.select({
          attempt: schema.testAttempts,
          employeeName: schema.users.fullName,
          trainingTitle: schema.trainingBlocks.title,
          moduleTitle: schema.trainingModuleVersions.title,
          version: schema.trainingModuleVersions.version,
        })
        .from(schema.testAttempts)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.testAttempts.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.testAttempts.trainingId))
        .innerJoin(schema.trainingModuleVersions, eq(schema.trainingModuleVersions.id, schema.testAttempts.moduleVersionId))
        .where(where)
        .orderBy(desc(schema.testAttempts.finishedAt))
        .limit(q.limit).offset((q.page - 1) * q.limit);

      return paginated(rows, q.page, q.limit, count);
    });

  /* Дополнительная попытка (§37 прототипа). */
  app.post('/api/testing/extra-attempt',
    { onRequest: [requireAuth, requirePermission(PERMISSION.EMPLOYEE_EDIT)] },
    async (request) => {
      const body = request.body as { employeeId: string; moduleId: string; reason?: string };
      const scope = await buildScope(request.user);
      await assertEmployeeVisible(scope, body.employeeId);

      const versions = await db.select().from(schema.trainingModuleVersions)
        .where(and(eq(schema.trainingModuleVersions.moduleId, body.moduleId),
                   eq(schema.trainingModuleVersions.status, 'published'))).limit(1);
      if (!versions[0]) throw NotFound('Опубликованная версия модуля не найдена.');

      const [created] = await db.insert(schema.extraAttempts).values({
        employeeId: body.employeeId,
        moduleVersionId: versions[0].id,
        grantedBy: request.user.userId,
        reason: body.reason ?? null,
      }).returning();

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'attempt_granted',
        entityType: 'module', entityId: body.moduleId, details: body.reason ?? '' });
      return ok(created);
    });

  /* Аналитика по вопросам: какие вопросы чаще всего проваливают. */
  app.get('/api/testing/modules/:id/analytics',
    { onRequest: [requireAuth, requirePermission(PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const versions = await db.select().from(schema.trainingModuleVersions)
        .where(and(eq(schema.trainingModuleVersions.moduleId, id),
                   eq(schema.trainingModuleVersions.status, 'published'))).limit(1);
      if (!versions[0]) throw NotFound('Модуль не опубликован.');

      const summary = await db.select({
          attempts: sql<number>`count(*)::int`,
          passed: sql<number>`count(*) filter (where ${schema.testAttempts.passed})::int`,
          avgScore: sql<number>`coalesce(round(avg(${schema.testAttempts.score})), 0)::int`,
          avgDuration: sql<number>`coalesce(round(avg(${schema.testAttempts.durationSec})), 0)::int`,
        })
        .from(schema.testAttempts)
        .where(and(eq(schema.testAttempts.moduleVersionId, versions[0].id),
                   sql`${schema.testAttempts.finishedAt} is not null`));

      const questionStats = await db.select({
          questionId: schema.testAnswers.questionId,
          text: schema.questions.text,
          total: sql<number>`count(*)::int`,
          correct: sql<number>`count(*) filter (where ${schema.testAnswers.isCorrect})::int`,
        })
        .from(schema.testAnswers)
        .innerJoin(schema.testAttempts, eq(schema.testAttempts.id, schema.testAnswers.attemptId))
        .innerJoin(schema.questions, eq(schema.questions.id, schema.testAnswers.questionId))
        .where(eq(schema.testAttempts.moduleVersionId, versions[0].id))
        .groupBy(schema.testAnswers.questionId, schema.questions.text);

      return ok({
        summary: summary[0],
        questions: questionStats
          .map((q) => ({ ...q, correctPct: q.total ? Math.round((q.correct / q.total) * 100) : 0 }))
          .sort((a, b) => a.correctPct - b.correctPct),
      });
    });
}
