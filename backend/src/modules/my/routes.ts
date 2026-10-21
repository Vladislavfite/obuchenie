import type { FastifyInstance } from 'fastify';
import { and, eq, sql, desc, inArray, isNull, or } from 'drizzle-orm';
import {
  moduleState, blockCompletionPct, programStatus, blockAccess, isModuleUnlocked,
  employeeProgressPct, employeeAvgScore, dueStatus, validityStatus,
} from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth } from '../../core/context.js';
import { NotFound, Forbidden } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';
import { loadVersionContent } from '../training/service.js';
import { loadBlockForProgress, attemptsByModuleMap } from '../testing/service.js';

/* Кабинет сотрудника.

   Все состояния (доступен / пройден / устарел / попытки исчерпаны) считаются
   доменными функциями из shared — теми же, что использовал прототип. Ничего
   не хранится: статус всегда выводится из попыток, поэтому рассогласование
   невозможно. */

function employeeOnly(request: { user: { employeeId: string | null } }) {
  if (!request.user.employeeId) throw Forbidden('Раздел доступен только сотрудникам.');
  return request.user.employeeId;
}

export async function myRoutes(app: FastifyInstance) {
  /* Назначенные обучения со сводкой прогресса. */
  app.get('/api/my/trainings', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);

    const assigned = await db.select({
        assignment: schema.assignments,
        block: schema.trainingBlocks,
      })
      .from(schema.assignments)
      .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.assignments.trainingId))
      .where(and(eq(schema.assignments.employeeId, employeeId),
                 isNull(schema.trainingBlocks.deletedAt),
                 eq(schema.trainingBlocks.status, 'published'),
                 sql`${schema.assignments.status} <> 'cancelled'`));

    /* Общедоступные обучения (isCore) видны без назначения. */
    const core = await db.select().from(schema.trainingBlocks)
      .where(and(eq(schema.trainingBlocks.organizationId, request.user.organizationId),
                 eq(schema.trainingBlocks.isCore, true),
                 eq(schema.trainingBlocks.status, 'published'),
                 isNull(schema.trainingBlocks.deletedAt)));

    const assignedIds = new Set(assigned.map((a) => a.block.id));
    const allBlocks = [
      ...assigned.map((a) => ({ block: a.block, assignment: a.assignment })),
      ...core.filter((b) => !assignedIds.has(b.id)).map((b) => ({ block: b, assignment: null })),
    ];

    const result = [];
    for (const entry of allBlocks) {
      const blockLike = await loadBlockForProgress(entry.block.id);
      if (!blockLike) continue;
      const attemptsMap = await attemptsByModuleMap(employeeId, blockLike.modules.map((m) => m.id));
      const pct = blockCompletionPct(blockLike, attemptsMap);

      let access = { allowed: true, reason: '' };
      if (entry.block.prereqBlockId) {
        const prereq = await loadBlockForProgress(entry.block.prereqBlockId);
        if (prereq) {
          const prereqAttempts = await attemptsByModuleMap(employeeId, prereq.modules.map((m) => m.id));
          access = blockAccess(blockLike, prereq, prereqAttempts);
        }
      }

      result.push({
        id: entry.block.id,
        slug: entry.block.slug,
        title: entry.block.title,
        description: entry.block.description,
        icon: entry.block.icon,
        sequential: entry.block.sequential,
        isCore: entry.block.isCore,
        moduleCount: blockLike.modules.filter((m) => m.status === 'published').length,
        completionPct: pct,
        status: programStatus(blockLike, attemptsMap),
        access,
        assignment: entry.assignment
          ? {
              id: entry.assignment.id,
              dueDate: entry.assignment.dueDate,
              priority: entry.assignment.priority,
              isRequired: entry.assignment.isRequired,
              status: entry.assignment.status,
              due: dueStatus(entry.assignment.dueDate),
            }
          : null,
      });
    }

    return ok(result);
  });

  /* Один блок с модулями и их состояниями. */
  app.get('/api/my/trainings/:id', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const { id } = request.params as { id: string };

    const blocks = await db.select().from(schema.trainingBlocks)
      .where(and(eq(schema.trainingBlocks.id, id),
                 eq(schema.trainingBlocks.organizationId, request.user.organizationId))).limit(1);
    if (!blocks[0]) throw NotFound('Обучение не найдено.');

    const assignment = await db.select().from(schema.assignments)
      .where(and(eq(schema.assignments.employeeId, employeeId), eq(schema.assignments.trainingId, id))).limit(1);
    if (!assignment[0] && !blocks[0].isCore) throw Forbidden('Это обучение вам не назначено.');

    const blockLike = await loadBlockForProgress(id);
    if (!blockLike) throw NotFound('Обучение не найдено.');

    const published = blockLike.modules.filter((m) => m.status === 'published');
    const attemptsMap = await attemptsByModuleMap(employeeId, published.map((m) => m.id));

    const versionIds = published.map((m) => m.publishedVersionId).filter(Boolean) as string[];
    const versions = versionIds.length
      ? await db.select().from(schema.trainingModuleVersions)
          .where(inArray(schema.trainingModuleVersions.id, versionIds))
      : [];

    const extra = await db.select({
        moduleVersionId: schema.extraAttempts.moduleVersionId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.extraAttempts)
      .where(eq(schema.extraAttempts.employeeId, employeeId))
      .groupBy(schema.extraAttempts.moduleVersionId);
    const extraByVersion = new Map(extra.map((e) => [e.moduleVersionId, e.count]));

    const modules = published.map((m, index) => {
      const version = versions.find((v) => v.id === m.publishedVersionId);
      const state = moduleState({
        module: m,
        attempts: attemptsMap.get(m.id) ?? [],
        extraAttempts: extraByVersion.get(m.publishedVersionId ?? '') ?? 0,
        unlocked: isModuleUnlocked(blockLike, index, attemptsMap),
      });
      return {
        id: m.id,
        sortOrder: m.sortOrder,
        title: version?.title ?? '',
        chapter: version?.chapter ?? null,
        description: version?.description ?? null,
        speaker: version?.speaker ?? null,
        version: version?.version ?? m.currentVersion,
        isRequired: m.isRequired,
        passingScore: m.passingScore,
        attemptLimit: m.attemptLimit,
        /* Наличие кода доступа показываем, сам код — нет. */
        requiresAccessCode: !!version?.accessCode,
        questionCount: version?.questionCount ?? 0,
        state: state.code,
        scores: state.scores,
        attemptsUsed: state.attemptsUsed,
        attemptsLeft: state.attemptsLeft,
        passedOlderVersion: state.passedOlderVersion,
      };
    });

    return ok({
      id: blocks[0].id,
      title: blocks[0].title,
      description: blocks[0].description,
      sequential: blocks[0].sequential,
      completionPct: blockCompletionPct(blockLike, attemptsMap),
      status: programStatus(blockLike, attemptsMap),
      assignment: assignment[0] ?? null,
      modules,
    });
  });

  /* Учебный материал модуля. Вопросы теста сюда НЕ входят. */
  app.get('/api/my/modules/:id', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const { id } = request.params as { id: string };

    const modules = await db.select().from(schema.trainingModules)
      .where(and(eq(schema.trainingModules.id, id), isNull(schema.trainingModules.deletedAt))).limit(1);
    if (!modules[0]) throw NotFound('Модуль не найден.');

    const assignment = await db.select().from(schema.assignments)
      .where(and(eq(schema.assignments.employeeId, employeeId),
                 eq(schema.assignments.trainingId, modules[0].trainingId))).limit(1);
    const block = await db.select({ isCore: schema.trainingBlocks.isCore })
      .from(schema.trainingBlocks).where(eq(schema.trainingBlocks.id, modules[0].trainingId)).limit(1);
    if (!assignment[0] && !block[0]?.isCore) throw Forbidden('Это обучение вам не назначено.');

    const versions = await db.select().from(schema.trainingModuleVersions)
      .where(and(eq(schema.trainingModuleVersions.moduleId, id),
                 eq(schema.trainingModuleVersions.status, 'published'))).limit(1);
    if (!versions[0]) throw NotFound('Модуль ещё не опубликован.');

    const content = await loadVersionContent(versions[0].id);

    await db.insert(schema.moduleProgress)
      .values({ employeeId, moduleVersionId: versions[0].id, startedAt: new Date(), materialOpenedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.moduleProgress.employeeId, schema.moduleProgress.moduleVersionId],
        set: { materialOpenedAt: new Date(), updatedAt: new Date() },
      });

    await db.update(schema.employeeProfiles).set({ lastActivityAt: new Date() })
      .where(eq(schema.employeeProfiles.id, employeeId));

    /* Ответ намеренно не содержит questions: вопросы выдаются только
       через POST /api/testing/attempts и без признака правильности. */
    return ok({
      id: modules[0].id,
      trainingId: modules[0].trainingId,
      version: content.version,
      title: content.title,
      chapter: content.chapter,
      description: content.description,
      speaker: content.speaker,
      passingScore: content.passingScore,
      attemptLimit: content.attemptLimit,
      requiresAccessCode: !!content.accessCode,
      questionsTotal: content.questions.length,
      questionsPerAttempt: content.questionCount || content.questions.length,
      contentItems: content.contentItems,
    });
  });

  /* Сводка для главной страницы кабинета. */
  app.get('/api/my/dashboard', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);

    const assigned = await db.select({ block: schema.trainingBlocks, assignment: schema.assignments })
      .from(schema.assignments)
      .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.assignments.trainingId))
      .where(and(eq(schema.assignments.employeeId, employeeId),
                 eq(schema.trainingBlocks.status, 'published')));

    const blockLikes = [];
    const allAttempts = new Map<string, never[]>();
    for (const a of assigned) {
      const bl = await loadBlockForProgress(a.block.id);
      if (bl) blockLikes.push(bl);
    }
    const allModuleIds = blockLikes.flatMap((b) => b.modules.map((m) => m.id));
    const attemptsMap = await attemptsByModuleMap(employeeId, allModuleIds);

    const certificates = await db.select().from(schema.certificates)
      .where(and(eq(schema.certificates.employeeId, employeeId), eq(schema.certificates.status, 'active')));

    const upcoming = assigned
      .filter((a) => a.assignment.dueDate && a.assignment.status !== 'completed')
      .map((a) => ({ trainingId: a.block.id, title: a.block.title, dueDate: a.assignment.dueDate,
                     due: dueStatus(a.assignment.dueDate) }))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
      .slice(0, 5);

    const recent = await db.select({
        attempt: schema.testAttempts,
        moduleTitle: schema.trainingModuleVersions.title,
      })
      .from(schema.testAttempts)
      .innerJoin(schema.trainingModuleVersions, eq(schema.trainingModuleVersions.id, schema.testAttempts.moduleVersionId))
      .where(and(eq(schema.testAttempts.employeeId, employeeId), sql`${schema.testAttempts.finishedAt} is not null`))
      .orderBy(desc(schema.testAttempts.finishedAt)).limit(5);

    return ok({
      assignedCount: assigned.length,
      completedCount: assigned.filter((a) => a.assignment.status === 'completed').length,
      overdueCount: assigned.filter((a) =>
        a.assignment.dueDate && a.assignment.status !== 'completed' && dueStatus(a.assignment.dueDate).level === 'overdue').length,
      progressPct: employeeProgressPct(blockLikes, attemptsMap),
      avgScore: employeeAvgScore(blockLikes, attemptsMap),
      certificates: certificates.map((c) => ({
        id: c.id, number: c.number, validUntil: c.validUntil, validity: validityStatus(c.validUntil),
      })),
      upcoming,
      recentAttempts: recent,
    });
  });

  app.get('/api/my/certificates', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const rows = await db.select({ certificate: schema.certificates, trainingTitle: schema.trainingBlocks.title })
      .from(schema.certificates)
      .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.certificates.trainingId))
      .where(eq(schema.certificates.employeeId, employeeId))
      .orderBy(desc(schema.certificates.issuedAt));
    return ok(rows.map((r) => ({ ...r, validity: validityStatus(r.certificate.validUntil) })));
  });

  app.get('/api/my/permits', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const rows = await db.select().from(schema.employeePermits)
      .where(eq(schema.employeePermits.employeeId, employeeId))
      .orderBy(desc(schema.employeePermits.issuedAt));
    return ok(rows.map((r) => ({ ...r, validity: validityStatus(r.validUntil) })));
  });

  app.get('/api/my/results', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const rows = await db.select({
        attempt: schema.testAttempts,
        moduleTitle: schema.trainingModuleVersions.title,
        version: schema.trainingModuleVersions.version,
        trainingTitle: schema.trainingBlocks.title,
      })
      .from(schema.testAttempts)
      .innerJoin(schema.trainingModuleVersions, eq(schema.trainingModuleVersions.id, schema.testAttempts.moduleVersionId))
      .innerJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.testAttempts.trainingId))
      .where(and(eq(schema.testAttempts.employeeId, employeeId), sql`${schema.testAttempts.finishedAt} is not null`))
      .orderBy(desc(schema.testAttempts.finishedAt));
    return ok(rows);
  });

  app.get('/api/my/profile', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const rows = await db.select({
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
      .where(eq(schema.employeeProfiles.id, employeeId)).limit(1);
    if (!rows[0]) throw NotFound('Профиль не найден.');
    const { passwordHash, ...user } = rows[0].user;
    return ok({ ...rows[0].profile, user, departmentName: rows[0].departmentName,
      positionName: rows[0].positionName, professionName: rows[0].professionName });
  });

  /* Сотрудник может менять только контактные данные (§34 ТЗ). */
  app.patch('/api/my/profile', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const body = request.body as { email?: string; phone?: string };
    await db.update(schema.users)
      .set({ email: body.email !== undefined ? body.email || null : undefined,
             phone: body.phone !== undefined ? body.phone || null : undefined, updatedAt: new Date() })
      .where(eq(schema.users.id, request.user.userId));
    return ok({ updated: true });
  });

  app.get('/api/my/notifications', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select().from(schema.notifications)
      .where(eq(schema.notifications.userId, request.user.userId))
      .orderBy(desc(schema.notifications.createdAt)).limit(50);
    return ok(rows);
  });

  app.post('/api/my/notifications/:id/read', { onRequest: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await db.update(schema.notifications).set({ readAt: new Date() })
      .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, request.user.userId)));
    return ok({ read: true });
  });

  /* Отзыв о модуле (§30 ТЗ). */
  app.post('/api/my/modules/:id/feedback', { onRequest: requireAuth }, async (request) => {
    const employeeId = employeeOnly(request);
    const { id } = request.params as { id: string };
    const body = request.body as { stars: number; comment?: string };
    const versions = await db.select().from(schema.trainingModuleVersions)
      .where(and(eq(schema.trainingModuleVersions.moduleId, id),
                 eq(schema.trainingModuleVersions.status, 'published'))).limit(1);
    if (!versions[0]) throw NotFound('Модуль не найден.');

    const stars = Math.min(5, Math.max(1, Math.round(Number(body.stars) || 0)));
    await db.insert(schema.moduleFeedback)
      .values({ employeeId, moduleVersionId: versions[0].id, stars, comment: body.comment ?? null })
      .onConflictDoUpdate({
        target: [schema.moduleFeedback.employeeId, schema.moduleFeedback.moduleVersionId],
        set: { stars, comment: body.comment ?? null },
      });
    await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
      actorLabel: request.user.fullName, action: 'feedback_submitted', entityType: 'module', entityId: id });
    return ok({ saved: true });
  });
}
