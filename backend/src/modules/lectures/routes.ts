import type { FastifyInstance } from 'fastify';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { lectureSchema, attendanceSchema, PERMISSION, parseVideoUrl, parseZoomUrl, safeLinkUrl } from '@tbedu/shared';
import { db, schema } from '../../db/client.js';
import { ok } from '../../core/response.js';
import { requireAuth, requirePermission, buildScope } from '../../core/context.js';
import { NotFound, ValidationError } from '../../core/errors.js';
import { logAudit } from '../../core/audit.js';

/* Лекции: онлайн (YouTube Live / Zoom) и офлайн с отметкой посещаемости. */

export async function lecturesRoutes(app: FastifyInstance) {
  app.get('/api/lectures', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select({ lecture: schema.lectures, trainingTitle: schema.trainingBlocks.title })
      .from(schema.lectures)
      .leftJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.lectures.trainingId))
      .where(eq(schema.lectures.organizationId, request.user.organizationId))
      .orderBy(desc(schema.lectures.startsAt));
    return ok(rows);
  });

  app.post('/api/lectures',
    { onRequest: [requireAuth, requirePermission(PERMISSION.LECTURE_CREATE)] },
    async (request) => {
      const body = lectureSchema.parse(request.body);

      /* Ссылка на трансляцию проверяется так же, как видео в материале:
         произвольный URL в iframe не попадает. */
      let joinUrl = body.joinUrl ? safeLinkUrl(body.joinUrl) : null;
      if (body.kind === 'online' && body.joinUrl) {
        const video = parseVideoUrl(body.joinUrl);
        const zoom = parseZoomUrl(body.joinUrl);
        if (!video && !zoom) throw ValidationError('Поддерживаются ссылки YouTube Live и Zoom.');
        joinUrl = video ? video.watchUrl : zoom!.joinUrl;
      }

      const [created] = await db.insert(schema.lectures).values({
        organizationId: request.user.organizationId,
        trainingId: body.trainingId ?? null,
        kind: body.kind,
        title: body.title,
        description: body.description ?? null,
        lecturerName: body.lecturerName ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        durationMin: body.durationMin ?? null,
        location: body.location ?? null,
        provider: body.provider ?? null,
        joinUrl,
        createdBy: request.user.userId,
      }).returning();

      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'lecture_created',
        entityType: 'lecture', entityId: created.id, details: body.title });
      return ok(created);
    });

  app.patch('/api/lectures/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.LECTURE_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = lectureSchema.partial().parse(request.body);
      const [updated] = await db.update(schema.lectures).set({
          title: body.title, description: body.description ?? undefined,
          lecturerName: body.lecturerName ?? undefined,
          startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
          durationMin: body.durationMin ?? undefined, location: body.location ?? undefined,
          joinUrl: body.joinUrl ? safeLinkUrl(body.joinUrl) : undefined,
        })
        .where(and(eq(schema.lectures.id, id), eq(schema.lectures.organizationId, request.user.organizationId)))
        .returning();
      if (!updated) throw NotFound('Лекция не найдена.');
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'lecture_updated', entityType: 'lecture', entityId: id });
      return ok(updated);
    });

  for (const [suffix, status, action] of [
    ['start', 'live', 'lecture_started'],
    ['finish', 'finished', 'lecture_finished'],
  ] as const) {
    app.post(`/api/lectures/:id/${suffix}`,
      { onRequest: [requireAuth, requirePermission(PERMISSION.LECTURE_LIVE)] },
      async (request) => {
        const { id } = request.params as { id: string };
        const [updated] = await db.update(schema.lectures).set({ status })
          .where(and(eq(schema.lectures.id, id), eq(schema.lectures.organizationId, request.user.organizationId)))
          .returning();
        if (!updated) throw NotFound('Лекция не найдена.');

        if (suffix === 'start') {
          await db.insert(schema.liveSessions).values({ lectureId: id, startedAt: new Date() });
        } else {
          const sessions = await db.select().from(schema.liveSessions)
            .where(eq(schema.liveSessions.lectureId, id)).orderBy(desc(schema.liveSessions.startedAt)).limit(1);
          if (sessions[0]) {
            await db.update(schema.liveSessions).set({ endedAt: new Date() })
              .where(eq(schema.liveSessions.id, sessions[0].id));
          }
        }
        await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
          actorLabel: request.user.fullName, action, entityType: 'lecture', entityId: id });
        return ok(updated);
      });
  }

  app.get('/api/lectures/:id/attendance',
    { onRequest: [requireAuth, requirePermission(PERMISSION.LECTURE_EDIT, PERMISSION.REPORTS_VIEW)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const rows = await db.select({
          record: schema.lectureAttendance,
          employeeName: schema.users.fullName,
        })
        .from(schema.lectureAttendance)
        .innerJoin(schema.employeeProfiles, eq(schema.employeeProfiles.id, schema.lectureAttendance.employeeId))
        .innerJoin(schema.users, eq(schema.users.id, schema.employeeProfiles.userId))
        .where(eq(schema.lectureAttendance.lectureId, id));
      return ok(rows);
    });

  app.put('/api/lectures/:id/attendance',
    { onRequest: [requireAuth, requirePermission(PERMISSION.LECTURE_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = attendanceSchema.parse(request.body);
      for (const record of body.records) {
        await db.insert(schema.lectureAttendance)
          .values({ lectureId: id, employeeId: record.employeeId, status: record.status, markedBy: request.user.userId })
          .onConflictDoUpdate({
            target: [schema.lectureAttendance.lectureId, schema.lectureAttendance.employeeId],
            set: { status: record.status, markedBy: request.user.userId, markedAt: new Date() },
          });
      }
      await logAudit({ organizationId: request.user.organizationId, actorUserId: request.user.userId,
        actorLabel: request.user.fullName, action: 'attendance_marked',
        entityType: 'lecture', entityId: id, details: `${body.records.length} записей` });
      return ok({ saved: body.records.length });
    });

  app.delete('/api/lectures/:id',
    { onRequest: [requireAuth, requirePermission(PERMISSION.LECTURE_EDIT)] },
    async (request) => {
      const { id } = request.params as { id: string };
      await db.delete(schema.lectures)
        .where(and(eq(schema.lectures.id, id), eq(schema.lectures.organizationId, request.user.organizationId)));
      return ok({ deleted: true });
    });

  /* Лекции для сотрудника. */
  app.get('/api/my/lectures', { onRequest: requireAuth }, async (request) => {
    const rows = await db.select({ lecture: schema.lectures, trainingTitle: schema.trainingBlocks.title })
      .from(schema.lectures)
      .leftJoin(schema.trainingBlocks, eq(schema.trainingBlocks.id, schema.lectures.trainingId))
      .where(eq(schema.lectures.organizationId, request.user.organizationId))
      .orderBy(desc(schema.lectures.startsAt)).limit(50);

    const attendance = request.user.employeeId
      ? await db.select().from(schema.lectureAttendance)
          .where(eq(schema.lectureAttendance.employeeId, request.user.employeeId))
      : [];
    const byLecture = new Map(attendance.map((a) => [a.lectureId, a.status]));

    return ok(rows.map((r) => ({ ...r, myAttendance: byLecture.get(r.lecture.id) ?? null })));
  });
}
